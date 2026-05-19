import { Response } from "express";
import { prisma } from "../config/prisma.js";
import { locationUpdateSchema } from "../validators/trip.validators.js";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { uuidParamSchema } from "../validators/params.validators.js";
import {
  beginIdempotentRequest,
  buildFingerprint,
  completeIdempotentRequest,
  failIdempotentRequest,
} from "../services/idempotency.service.js";
import { getRequestIp } from "../services/audit.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";
import {
  startTripService,
  getCurrentDriverTripService,
} from "../services/trip.service.js";
import { finalizeTripService } from "../services/tripLifecycle.service.js";
import { processDriverLocationUpdate } from "../services/driverLocation.service.js";

export async function getCurrentTrip(req: AuthRequest, res: Response) {
  const driverId = req.user?.id;

  if (!driverId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  const trip = await getCurrentDriverTripService(driverId);

  return sendSuccess(res, {
    message: trip
      ? "Current driver trip fetched successfully"
      : "No active or planned trip found for this driver",
    data: trip,
  });
}

export async function startTrip(req: AuthRequest, res: Response) {
  const driverId = req.user?.id;

  if (!driverId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  const idempotencyKey = req.header("Idempotency-Key");

  if (!idempotencyKey) {
    throw new AppError({
      statusCode: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required",
    });
  }

  const result = await startTripService({
    driverId,
    idempotencyKey,
    req,
  });

  return res.status(result.statusCode).json(result.body);
}

/**
 * HTTP location ingestion. Kept as an automatic fallback for the realtime
 * `driver:location` socket channel; both transports share the same pipeline
 * via processDriverLocationUpdate.
 */
export async function sendLocation(req: AuthRequest, res: Response) {
  const driverId = req.user?.id;
  if (!driverId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  const tripIdParsed = uuidParamSchema.safeParse(req.params.tripId);
  if (!tripIdParsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_TRIP_ID",
      message: "Invalid tripId",
    });
  }
  const tripId = tripIdParsed.data;

  const parsed = locationUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    req.log?.warn(
      { tripId, driverId, errors: parsed.error.format() },
      "sendLocation validation failed",
    );

    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid data",
      details: parsed.error.format(),
    });
  }

  const result = await processDriverLocationUpdate({
    driverId,
    tripId,
    input: parsed.data,
    logger: req.log,
  });

  return sendSuccess(res, {
    message: result.accepted ? "Location accepted" : "Location filtered",
    data: result,
  });
}

export async function endTrip(req: AuthRequest, res: Response) {
  const driverId = req.user?.id;
  if (!driverId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  const tripIdParsed = uuidParamSchema.safeParse(req.params.tripId);
  if (!tripIdParsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_TRIP_ID",
      message: "Invalid tripId",
    });
  }

  const tripId = tripIdParsed.data;

  req.log?.info({ tripId, driverId }, "endTrip requested");

  const idempotencyKeyHeader = req.header("Idempotency-Key");
  if (!idempotencyKeyHeader || idempotencyKeyHeader.trim().length === 0) {
    req.log?.warn({ tripId, driverId }, "missing Idempotency-Key for endTrip");
    throw new AppError({
      statusCode: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required",
    });
  }

  const idempotencyKey = idempotencyKeyHeader.trim();

  const fingerprint = buildFingerprint({
    action: "endTrip",
    driverId,
    tripId,
  });

  const idem = await beginIdempotentRequest({
    idempotencyKey,
    fingerprint,
  });

  if (idem.type === "REPLAY") {
    req.log?.info(
      { tripId, driverId, idempotencyKey },
      "endTrip idempotency replay",
    );
    return res.status(idem.response.statusCode).json(idem.response.body);
  }

  if (idem.type === "CONFLICT") {
    req.log?.warn(
      { tripId, driverId, idempotencyKey },
      "endTrip idempotency conflict",
    );
    throw new AppError({
      statusCode: 409,
      code: "IDEMPOTENCY_CONFLICT",
      message: "Idempotency-Key already used for a different request",
    });
  }

  if (idem.type === "IN_PROGRESS") {
    req.log?.warn(
      { tripId, driverId, idempotencyKey },
      "endTrip idempotency in progress",
    );
    throw new AppError({
      statusCode: 409,
      code: "IDEMPOTENT_REQUEST_IN_PROGRESS",
      message: "This request is already being processed",
    });
  }

  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });

    if (!trip) {
      await failIdempotentRequest(idempotencyKey);
      req.log?.warn({ tripId, driverId }, "trip not found for endTrip");
      throw new AppError({
        statusCode: 404,
        code: "TRIP_NOT_FOUND",
        message: "Trip not found",
      });
    }

    if (trip.driverId !== driverId) {
      await failIdempotentRequest(idempotencyKey);
      req.log?.warn({ tripId, driverId }, "endTrip forbidden");
      throw new AppError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Not your trip",
      });
    }

    if (trip.status === "ENDED") {
      const responseBody = {
        success: true,
        message: "Trip already ended",
        data: { trip },
      };

      await completeIdempotentRequest({
        idempotencyKey,
        fingerprint,
        statusCode: 200,
        body: responseBody,
      });

      req.log?.info(
        { tripId, driverId },
        "endTrip replay on already ended trip",
      );

      return res.json(responseBody);
    }

    const endedAt = trip.endTime ?? new Date();

    const finalized = await finalizeTripService({
      tripId: trip.id,
      endedAt,
      endMode: "MANUAL_DRIVER",
      endReason: "MANUAL_DRIVER",
      endedBySourceType: "DRIVER_MOBILE",
      actorUserId: driverId,
      actorRole: req.user?.role ?? null,
      route: req.originalUrl,
      method: req.method,
      requestId: req.requestId ?? null,
      ip: getRequestIp(req),
      userAgent: req.headers["user-agent"]?.toString() ?? null,
      metaJson: {
        idempotencyKey,
      },
    });

    req.log?.info({ tripId, driverId }, "trip ended");

    const responseBody = {
      success: true,
      message: finalized.alreadyEnded
        ? "Trip already ended"
        : "Trip ended successfully",
      data: { trip: finalized.trip },
    };

    await completeIdempotentRequest({
      idempotencyKey,
      fingerprint,
      statusCode: 200,
      body: responseBody,
    });

    return res.json(responseBody);
  } catch (err) {
    await failIdempotentRequest(idempotencyKey);
    req.log?.error({ err, tripId, driverId }, "endTrip failed");
    throw err;
  }
}
