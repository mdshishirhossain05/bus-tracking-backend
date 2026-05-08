import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { locationUpdateSchema } from "../validators/trip.validators.js";
import {
  emitTripEtaUpdated,
  emitTripLocationUpdated,
  emitTripStopArrival,
} from "../sockets/tripRealtime.js";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import {
  canSendLocation,
  isMonotonic,
} from "../services/locationRateLimiter.js";
import { uuidParamSchema } from "../validators/params.validators.js";
import { detectStopArrival } from "../services/arrival.service.js";
import { maybePersistLocation } from "../services/locationBuffer.service.js";
import {
  type TripRealtimeState,
  setTripSourceRealtimeState,
} from "../services/tripRealtimeState.service.js";
import { computeNextStopAndEta } from "../services/eta.service.js";
import { getStopsForTrip } from "../services/tripStopsCache.service.js";
import { filterTrackingPoint } from "../services/trackingFilter.service.js";
import {
  beginIdempotentRequest,
  buildFingerprint,
  completeIdempotentRequest,
  failIdempotentRequest,
} from "../services/idempotency.service.js";
import { getRequestIp } from "../services/audit.service.js";
import { logEtaUpdated } from "../services/tripEvent.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";
import {
  startTripService,
  getCurrentDriverTripService,
} from "../services/trip.service.js";
import { getLatestArrivedStopForTrip } from "../services/stopArrivalProgress.service.js";
import { arbitrateTripTrackingSource } from "../services/sourceArbitration.service.js";
import {
  finalizeTripService,
  maybeAutoEndTripService,
} from "../services/tripLifecycle.service.js";

function buildLiveSourceLabel(filteredState: {
  sourceLabel: string | null;
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
}) {
  return (
    filteredState.sourceLabel ??
    (filteredState.sourceType === "GPS_DEVICE"
      ? "GPS Device"
      : filteredState.sourceType === "DRIVER_MOBILE"
        ? "Driver Mobile"
        : "DB_TRIP_SNAPSHOT")
  );
}

function roundNumber(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pickCurrentSpeedKmh(state: {
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
  rawSpeedKmh: number | null;
  speedKmh: number | null;
  displaySpeedKmh: number | null;
  averageSpeedKmh: number | null;
  isStationary: boolean;
}) {
  if (state.isStationary) return 0;

  if (state.sourceType === "GPS_DEVICE") {
    return (
      state.displaySpeedKmh ??
      state.speedKmh ??
      state.rawSpeedKmh ??
      state.averageSpeedKmh
    );
  }

  const current = state.speedKmh ?? 0;
  const display = state.displaySpeedKmh ?? current;
  const average = state.averageSpeedKmh ?? display;

  if (state.rawSpeedKmh == null) {
    return roundNumber(current * 0.7 + display * 0.3, 1);
  }

  const raw = state.rawSpeedKmh;

  if (raw >= 35) {
    return roundNumber(current * 0.5 + display * 0.25 + raw * 0.25, 1);
  }

  if (raw >= 10) {
    return roundNumber(current * 0.58 + display * 0.27 + raw * 0.15, 1);
  }

  return roundNumber(current * 0.62 + display * 0.28 + average * 0.1, 1);
}

function pickEtaSpeedKmh(state: {
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
  rawSpeedKmh: number | null;
  speedKmh: number | null;
  displaySpeedKmh: number | null;
  averageSpeedKmh: number | null;
  isStationary: boolean;
}) {
  if (state.isStationary) return 0;

  if (state.sourceType === "GPS_DEVICE") {
    return (
      state.displaySpeedKmh ??
      state.speedKmh ??
      state.rawSpeedKmh ??
      state.averageSpeedKmh
    );
  }

  const current = state.speedKmh ?? 0;
  const display = state.displaySpeedKmh ?? current;
  const average = state.averageSpeedKmh ?? display;

  if (state.rawSpeedKmh != null && state.rawSpeedKmh >= 30) {
    return roundNumber(
      display * 0.45 + current * 0.35 + state.rawSpeedKmh * 0.2,
      1,
    );
  }

  return roundNumber(display * 0.5 + average * 0.35 + current * 0.15, 1);
}

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

async function recomputeAndPublishEta(params: {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string;
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
  rawSpeedKmh: number | null;
  speedKmh: number | null;
  displaySpeedKmh: number | null;
  rollingAverageSpeedKmh: number | null;
  isStationary: boolean;
  currentLat: number;
  currentLng: number;
  updatedAt: Date;
}) {
  const {
    tripId,
    routeId,
    busId,
    driverId,
    sourceType,
    rawSpeedKmh,
    speedKmh,
    displaySpeedKmh,
    rollingAverageSpeedKmh,
    isStationary,
    currentLat,
    currentLng,
    updatedAt,
  } = params;

  const [{ stops }, latestArrival] = await Promise.all([
    getStopsForTrip(tripId),
    getLatestArrivedStopForTrip(tripId),
  ]);

  const eta = computeNextStopAndEta({
    currentLat,
    currentLng,
    stops,
    lastSpeedKmh: pickEtaSpeedKmh({
      sourceType,
      rawSpeedKmh,
      speedKmh,
      displaySpeedKmh,
      averageSpeedKmh: rollingAverageSpeedKmh,
      isStationary,
    }),
    rollingAverageSpeedKmh,
    defaultSpeedKmh: Number(env.DEFAULT_SPEED_KMH ?? 20),
    arrivalRadiusMeters: Number(env.ARRIVAL_RADIUS_METERS ?? 80),
    lastArrivedStopId: latestArrival?.stopId ?? null,
  });

  if (!eta) {
    return null;
  }

  const nextStopName = eta.nextStop?.stopName ?? null;

  await prisma.trip.update({
    where: { id: tripId },
    data: {
      lastEtaMinutes: eta.etaMinutes,
      nextStopName,
    },
  });

  await logEtaUpdated({
    tripId,
    routeId,
    busId,
    driverId,
    etaMinutes: eta.etaMinutes,
    nextStopName,
    updatedAt,
  });

  emitTripEtaUpdated({
    tripId,
    etaMinutes: eta.etaMinutes,
    nextStopName,
    updatedAt: updatedAt.toISOString(),
    eta: {
      ...eta,
      nextStopName,
      nextStopDistanceMeters: eta.nextStop?.distanceMeters ?? null,
      nearestStopName: eta.nearestStop.stopName,
      nearestStopDistanceMeters: eta.nearestStop.distanceMeters,
    },
  });

  return eta;
}

function liveStateResponse(state: TripRealtimeState, updatedAtIso: string) {
  const currentSpeedKmh = pickCurrentSpeedKmh({
    sourceType: state.sourceType,
    rawSpeedKmh: state.rawSpeedKmh,
    speedKmh: state.speedKmh,
    displaySpeedKmh: state.displaySpeedKmh,
    averageSpeedKmh: state.averageSpeedKmh,
    isStationary: state.isStationary,
  });

  return {
    lat: state.lat,
    lng: state.lng,
    latitude: state.lat,
    longitude: state.lng,
    speedKmh: currentSpeedKmh,
    speed: currentSpeedKmh,
    filteredSpeedKmh: state.speedKmh,
    rawSpeedKmh: state.rawSpeedKmh,
    averageSpeedKmh: state.averageSpeedKmh,
    rollingAverageSpeedKmh: state.averageSpeedKmh,
    displaySpeedKmh: state.displaySpeedKmh,
    heading: state.heading,
    accuracyM: state.accuracyM,
    isStationary: state.isStationary,
    distanceDeltaMeters: state.distanceDeltaMeters,
    elapsedSeconds: state.elapsedSeconds,
    source: buildLiveSourceLabel(state),
    sourceType: state.sourceType,
    sourceStatus: state.sourceStatus,
    selectionReason: state.selectionReason,
    updatedAt: updatedAtIso,
  };
}

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

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new AppError({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
      message: "Trip not found",
    });
  }

  if (trip.status !== "RUNNING") {
    req.log?.warn({ tripId, driverId }, "sendLocation on non-running trip");
    throw new AppError({
      statusCode: 400,
      code: "TRIP_NOT_RUNNING",
      message: "Trip is not running",
    });
  }

  if (trip.driverId !== driverId) {
    req.log?.warn({ tripId, driverId }, "sendLocation forbidden");
    throw new AppError({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Not your trip",
    });
  }

  const key = `${driverId}:${tripId}`;

  const rate = canSendLocation(
    key,
    Number(env.LOCATION_MIN_INTERVAL_MS ?? 2000),
  );

  if (!rate.allowed) {
    req.log?.warn({ tripId, driverId }, "location update rate limited");
    throw new AppError({
      statusCode: 429,
      code: rate.reason ?? "RATE_LIMITED",
      message: "Too many updates",
      details: { minIntervalMs: Number(env.LOCATION_MIN_INTERVAL_MS ?? 2000) },
    });
  }

  const recordedAt = parsed.data.recordedAt
    ? new Date(parsed.data.recordedAt)
    : new Date();

  const monotonic = isMonotonic(key, recordedAt);

  if (!monotonic.allowed) {
    req.log?.warn(
      { tripId, driverId, recordedAt: recordedAt.toISOString() },
      "stale gps point rejected",
    );

    throw new AppError({
      statusCode: 400,
      code: monotonic.reason ?? "STALE_TIMESTAMP",
      message: "Stale GPS point",
    });
  }

  const filtered = await filterTrackingPoint({
    tripId,
    lat: parsed.data.lat,
    lng: parsed.data.lng,
    speedKmh: parsed.data.speedKmh ?? null,
    heading: parsed.data.heading ?? null,
    accuracyM: parsed.data.accuracyM ?? null,
    recordedAt,
  });

  await setTripSourceRealtimeState(tripId, "DRIVER_MOBILE", filtered.state);

  await prisma.$transaction(async (tx) => {
    await tx.trip.update({
      where: { id: tripId },
      data: {
        lastLatitude: new Prisma.Decimal(filtered.state.lat),
        lastLongitude: new Prisma.Decimal(filtered.state.lng),
        lastSpeedKmh:
          filtered.state.speedKmh != null
            ? new Prisma.Decimal(filtered.state.speedKmh)
            : null,
        lastHeading: filtered.state.heading ?? null,
        lastAccuracyM:
          filtered.state.accuracyM != null
            ? new Prisma.Decimal(filtered.state.accuracyM)
            : null,
        lastLocationAt: recordedAt,
        isStale: false,
        lastTrackingSourceType: "DRIVER_MOBILE",
        lastTrackingSourceStatus: "HEALTHY",
        lastTrackingSelectionReason: "DRIVER_ONLY",
        lastTrackingSourceLabel: "Driver Mobile",
        lastTrackingSourceRecordedAt: recordedAt,
      },
    });

    await tx.sourceTrackingState.upsert({
      where: {
        busId_sourceType: {
          busId: trip.busId,
          sourceType: "DRIVER_MOBILE",
        },
      },
      update: {
        tripId: trip.id,
        sourceStatus: "HEALTHY",
        sourceLabel: "Driver Mobile",
        driverId: trip.driverId,
        gpsDeviceId: null,
        latitude: new Prisma.Decimal(filtered.state.lat),
        longitude: new Prisma.Decimal(filtered.state.lng),
        speedKmh:
          filtered.state.speedKmh != null
            ? new Prisma.Decimal(filtered.state.speedKmh)
            : null,
        rawSpeedKmh:
          filtered.state.rawSpeedKmh != null
            ? new Prisma.Decimal(filtered.state.rawSpeedKmh)
            : null,
        averageSpeedKmh:
          filtered.state.averageSpeedKmh != null
            ? new Prisma.Decimal(filtered.state.averageSpeedKmh)
            : null,
        displaySpeedKmh:
          filtered.state.displaySpeedKmh != null
            ? new Prisma.Decimal(filtered.state.displaySpeedKmh)
            : null,
        heading: filtered.state.heading,
        accuracyM:
          filtered.state.accuracyM != null
            ? new Prisma.Decimal(filtered.state.accuracyM)
            : null,
        recordedAt,
        lastSeenAt: new Date(),
        healthScore: 95,
        isSelected: false,
        priorityRank: 20,
      },
      create: {
        busId: trip.busId,
        tripId: trip.id,
        sourceType: "DRIVER_MOBILE",
        sourceStatus: "HEALTHY",
        sourceLabel: "Driver Mobile",
        driverId: trip.driverId,
        gpsDeviceId: null,
        latitude: new Prisma.Decimal(filtered.state.lat),
        longitude: new Prisma.Decimal(filtered.state.lng),
        speedKmh:
          filtered.state.speedKmh != null
            ? new Prisma.Decimal(filtered.state.speedKmh)
            : null,
        rawSpeedKmh:
          filtered.state.rawSpeedKmh != null
            ? new Prisma.Decimal(filtered.state.rawSpeedKmh)
            : null,
        averageSpeedKmh:
          filtered.state.averageSpeedKmh != null
            ? new Prisma.Decimal(filtered.state.averageSpeedKmh)
            : null,
        displaySpeedKmh:
          filtered.state.displaySpeedKmh != null
            ? new Prisma.Decimal(filtered.state.displaySpeedKmh)
            : null,
        heading: filtered.state.heading,
        accuracyM:
          filtered.state.accuracyM != null
            ? new Prisma.Decimal(filtered.state.accuracyM)
            : null,
        recordedAt,
        lastSeenAt: new Date(),
        healthScore: 95,
        isSelected: false,
        priorityRank: 20,
      },
    });
  });

  const selectedState =
    (await arbitrateTripTrackingSource({
      tripId: trip.id,
      busId: trip.busId,
    })) ?? filtered.state;

  emitTripLocationUpdated({
    tripId: trip.id,
    routeId: trip.routeId,
    busId: trip.busId,
    driverId: trip.driverId,
    lat: selectedState.lat,
    lng: selectedState.lng,
    speedKmh: pickCurrentSpeedKmh({
      sourceType: selectedState.sourceType,
      rawSpeedKmh: selectedState.rawSpeedKmh,
      speedKmh: selectedState.speedKmh,
      displaySpeedKmh: selectedState.displaySpeedKmh,
      averageSpeedKmh: selectedState.averageSpeedKmh,
      isStationary: selectedState.isStationary,
    }),
    rawSpeedKmh: selectedState.rawSpeedKmh,
    averageSpeedKmh: selectedState.averageSpeedKmh,
    displaySpeedKmh: selectedState.displaySpeedKmh,
    heading: selectedState.heading,
    accuracyM: selectedState.accuracyM,
    isStationary: selectedState.isStationary,
    distanceDeltaMeters: selectedState.distanceDeltaMeters,
    elapsedSeconds: selectedState.elapsedSeconds,
    source: buildLiveSourceLabel(selectedState),
    sourceType: selectedState.sourceType,
    sourceStatus: selectedState.sourceStatus,
    selectionReason: selectedState.selectionReason,
    recordedAt: selectedState.recordedAt,
  });

  let latestEta = null;

  try {
    latestEta = await recomputeAndPublishEta({
      tripId,
      routeId: trip.routeId,
      busId: trip.busId,
      driverId: trip.driverId,
      sourceType: selectedState.sourceType,
      rawSpeedKmh: selectedState.rawSpeedKmh,
      speedKmh: selectedState.speedKmh,
      displaySpeedKmh: selectedState.displaySpeedKmh,
      rollingAverageSpeedKmh: selectedState.averageSpeedKmh,
      isStationary: selectedState.isStationary,
      currentLat: selectedState.lat,
      currentLng: selectedState.lng,
      updatedAt: new Date(selectedState.recordedAt),
    });
  } catch (err) {
    req.log?.warn({ tripId, driverId, err }, "initial eta update failed");
  }

  const persist = await maybePersistLocation({
    tripId,
    lat: selectedState.lat,
    lng: selectedState.lng,
    speedKmh: selectedState.speedKmh ?? null,
    heading: selectedState.heading ?? null,
    accuracyM: selectedState.accuracyM ?? null,
    recordedAt: new Date(selectedState.recordedAt),
  });

  let arrival: Awaited<ReturnType<typeof detectStopArrival>> | null = null;

  if (filtered.accepted) {
    arrival = await detectStopArrival({
      tripId,
      currentLat: selectedState.lat,
      currentLng: selectedState.lng,
      recordedAt: new Date(selectedState.recordedAt),
    });

    if (arrival) {
      req.log?.info(
        {
          tripId,
          driverId,
          stopId: arrival.stopId,
          stopName: arrival.stopName,
          stopOrder: arrival.stopOrder,
          distanceMeters: arrival.distanceMeters,
          persisted: persist.persisted,
        },
        "stop arrival detected",
      );

      emitTripStopArrival({
        tripId,
        routeId: trip.routeId,
        busId: trip.busId,
        driverId: trip.driverId,
        stopId: arrival.stopId,
        stopName: arrival.stopName,
        stopOrder: arrival.stopOrder,
        arrivalTime: arrival.arrivalTime,
        recordedAt: arrival.arrivalTime,
        distanceMeters: arrival.distanceMeters,
        dayType: arrival.dayType,
        scheduledTime: arrival.scheduledTime,
        scheduledDateUtc: arrival.scheduledDateUtc,
        delayMinutes: arrival.delayMinutes,
        status: arrival.status,
      });

      try {
        latestEta = await recomputeAndPublishEta({
          tripId,
          routeId: trip.routeId,
          busId: trip.busId,
          driverId: trip.driverId,
          sourceType: selectedState.sourceType,
          rawSpeedKmh: selectedState.rawSpeedKmh,
          speedKmh: selectedState.speedKmh,
          displaySpeedKmh: selectedState.displaySpeedKmh,
          rollingAverageSpeedKmh: selectedState.averageSpeedKmh,
          isStationary: selectedState.isStationary,
          currentLat: selectedState.lat,
          currentLng: selectedState.lng,
          updatedAt: new Date(selectedState.recordedAt),
        });
      } catch (err) {
        req.log?.warn(
          { tripId, driverId, stopId: arrival.stopId, err },
          "post-arrival eta refresh failed",
        );
      }
    }
  }

  const autoEndResult = await maybeAutoEndTripService({
    tripId,
    sourceType: selectedState.sourceType,
    sourceStatus: selectedState.sourceStatus,
    currentLat: selectedState.lat,
    currentLng: selectedState.lng,
    currentSpeedKmh: pickCurrentSpeedKmh({
      sourceType: selectedState.sourceType,
      rawSpeedKmh: selectedState.rawSpeedKmh,
      speedKmh: selectedState.speedKmh,
      displaySpeedKmh: selectedState.displaySpeedKmh,
      averageSpeedKmh: selectedState.averageSpeedKmh,
      isStationary: selectedState.isStationary,
    }),
    isStationary: selectedState.isStationary,
    recordedAt: new Date(selectedState.recordedAt),
  });

  return sendSuccess(res, {
    message: filtered.accepted ? "Location accepted" : "Location filtered",
    data: {
      recordedAt: recordedAt.toISOString(),
      persisted: persist.persisted,
      accepted: filtered.accepted,
      reason: filtered.reason ?? null,
      arrival,
      autoEnd: autoEndResult,
      eta: latestEta
        ? {
            ...latestEta,
            nextStopName: latestEta.nextStop?.stopName ?? null,
            nextStopDistanceMeters: latestEta.nextStop?.distanceMeters ?? null,
            nearestStopName: latestEta.nearestStop.stopName,
            nearestStopDistanceMeters: latestEta.nearestStop.distanceMeters,
          }
        : null,
      liveState: liveStateResponse(
        selectedState,
        new Date(selectedState.recordedAt).toISOString(),
      ),
    },
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
