import { Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { sendSuccess } from "../../utils/apiResponse.js";
import { AppError } from "../../utils/appError.js";
import { uuidParamSchema } from "../../validators/params.validators.js";
import { getRequestIp } from "../../services/audit.service.js";
import {
  getAdminOperationsOverviewService,
  getAdminOperationsEventsService,
  getAdminTripSourceDiagnosticsService,
  getAdminActiveTripsService,
  getAdminTripOperationsDetailService,
  forceEndAdminTripService,
  forceRecoverAdminTripService,
  startAdminTripService,
  setTripAutoEndService,
} from "../../services/adminOperations.service.js";

export async function getAdminOperationsOverview(
  _req: AuthRequest,
  res: Response,
) {
  const data = await getAdminOperationsOverviewService();

  return sendSuccess(res, {
    message: "Admin operations overview fetched successfully",
    data,
  });
}

export async function startAdminTrip(req: AuthRequest, res: Response) {
  const parsed = uuidParamSchema.safeParse(req.body?.serviceScheduleId);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_SERVICE_SCHEDULE_ID",
      message: "A valid serviceScheduleId is required",
    });
  }

  const data = await startAdminTripService({
    serviceScheduleId: parsed.data,
    adminUserId: req.user?.id ?? null,
    adminRole: req.user?.role ?? null,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
  });

  return sendSuccess(res, {
    message: "Trip started successfully",
    data,
  });
}

export async function setAdminTripAutoEnd(req: AuthRequest, res: Response) {
  const parsedTripId = uuidParamSchema.safeParse(req.params.tripId);

  if (!parsedTripId.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_TRIP_ID",
      message: "Invalid tripId",
    });
  }

  if (typeof req.body?.disabled !== "boolean") {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_BODY",
      message: "`disabled` must be a boolean",
    });
  }

  const data = await setTripAutoEndService({
    tripId: parsedTripId.data,
    disabled: req.body.disabled,
    adminUserId: req.user?.id ?? null,
    adminRole: req.user?.role ?? null,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
  });

  return sendSuccess(res, {
    message: data.autoEndDisabled
      ? "Auto-end disabled for this trip"
      : "Auto-end re-enabled for this trip",
    data,
  });
}

export async function getAdminOperationsEvents(
  req: AuthRequest,
  res: Response,
) {
  const rawLimit = req.query.limit;
  const parsedLimit =
    typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : null;

  const limit =
    typeof parsedLimit === "number" && Number.isFinite(parsedLimit)
      ? parsedLimit
      : null;

  const data =
    limit !== null
      ? await getAdminOperationsEventsService({ limit })
      : await getAdminOperationsEventsService();

  return sendSuccess(res, {
    message: "Admin operations events fetched successfully",
    data,
  });
}

export async function getAdminTripSourceDiagnostics(
  req: AuthRequest,
  res: Response,
) {
  const parsedTripId = uuidParamSchema.safeParse(req.params.tripId);

  if (!parsedTripId.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_TRIP_ID",
      message: "Invalid tripId",
    });
  }

  const data = await getAdminTripSourceDiagnosticsService(parsedTripId.data);

  return sendSuccess(res, {
    message: "Admin trip source diagnostics fetched successfully",
    data,
  });
}

export async function getAdminActiveTrips(_req: AuthRequest, res: Response) {
  const data = await getAdminActiveTripsService();

  return sendSuccess(res, {
    message: "Admin active trips fetched successfully",
    data,
  });
}

export async function getAdminTripOperationsDetail(
  req: AuthRequest,
  res: Response,
) {
  const parsedTripId = uuidParamSchema.safeParse(req.params.tripId);

  if (!parsedTripId.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_TRIP_ID",
      message: "Invalid tripId",
    });
  }

  const data = await getAdminTripOperationsDetailService(parsedTripId.data);

  return sendSuccess(res, {
    message: "Admin trip operations detail fetched successfully",
    data,
  });
}

export async function forceEndAdminTrip(req: AuthRequest, res: Response) {
  const parsedTripId = uuidParamSchema.safeParse(req.params.tripId);

  if (!parsedTripId.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_TRIP_ID",
      message: "Invalid tripId",
    });
  }

  const data = await forceEndAdminTripService({
    tripId: parsedTripId.data,
    adminUserId: req.user?.id ?? null,
    adminRole: req.user?.role ?? null,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
  });

  return sendSuccess(res, {
    message: data.alreadyEnded
      ? "Trip already ended"
      : "Trip force-ended successfully",
    data,
  });
}

export async function forceRecoverAdminTrip(req: AuthRequest, res: Response) {
  const parsedTripId = uuidParamSchema.safeParse(req.params.tripId);

  if (!parsedTripId.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_TRIP_ID",
      message: "Invalid tripId",
    });
  }

  const data = await forceRecoverAdminTripService({
    tripId: parsedTripId.data,
    adminUserId: req.user?.id ?? null,
    adminRole: req.user?.role ?? null,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
  });

  return sendSuccess(res, {
    message: "Trip operational state recovered successfully",
    data,
  });
}
