import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";
import {
  startRouteVisitService,
  endRouteVisitService,
  listVisitHistoryService,
  getVisitStatsService,
} from "../services/routeVisit.service.js";
import {
  voteOccupancyService,
  getOccupancyAggregateService,
} from "../services/occupancy.service.js";
import { listActiveAlertsService } from "../services/serviceAlert.service.js";

function requireUserId(req: AuthRequest): string {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  return userId;
}

function paramString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ---- Route visits / personal stats ----

export async function startRouteVisit(req: AuthRequest, res: Response) {
  const body = req.body ?? {};
  const routeId = paramString(body.routeId);
  if (!routeId) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_BODY",
      message: "routeId is required",
    });
  }
  const tripId = paramString(body.tripId);
  const data = await startRouteVisitService({
    userId: requireUserId(req),
    routeId,
    tripId,
  });
  return sendSuccess(res, {
    message: "Visit started",
    data,
  });
}

export async function endRouteVisit(req: AuthRequest, res: Response) {
  const visitId = paramString(req.params.visitId);
  if (!visitId) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_PARAMS",
      message: "visitId is required",
    });
  }
  const data = await endRouteVisitService({
    userId: requireUserId(req),
    visitId,
  });
  return sendSuccess(res, {
    message: "Visit ended",
    data,
  });
}

export async function listVisitHistory(req: AuthRequest, res: Response) {
  const items = await listVisitHistoryService(requireUserId(req));
  return sendSuccess(res, {
    message: "Visit history fetched",
    data: { items },
  });
}

export async function getVisitStats(req: AuthRequest, res: Response) {
  const stats = await getVisitStatsService(requireUserId(req));
  return sendSuccess(res, {
    message: "Stats fetched",
    data: stats,
  });
}

// ---- Occupancy voting ----

export async function voteOccupancy(req: AuthRequest, res: Response) {
  const tripId = paramString(req.params.tripId);
  if (!tripId) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_PARAMS",
      message: "tripId is required",
    });
  }
  const data = await voteOccupancyService({
    userId: requireUserId(req),
    tripId,
    level: req.body?.level,
  });
  return sendSuccess(res, {
    message: "Occupancy vote recorded",
    data,
  });
}

export async function getOccupancy(req: AuthRequest, res: Response) {
  const tripId = paramString(req.params.tripId);
  if (!tripId) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_PARAMS",
      message: "tripId is required",
    });
  }
  const data = await getOccupancyAggregateService({
    userId: requireUserId(req),
    tripId,
  });
  return sendSuccess(res, {
    message: "Occupancy fetched",
    data,
  });
}

// ---- Service alerts (passenger read-only) ----

export async function listAlerts(req: AuthRequest, res: Response) {
  const routeId = paramString(req.query.routeId);
  const items = await listActiveAlertsService(routeId);
  return sendSuccess(res, {
    message: "Alerts fetched",
    data: { items },
  });
}
