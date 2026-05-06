import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { uuidParamSchema } from "../validators/params.validators.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";
import {
  getLiveBusesByRouteService,
  getLiveTripStateService,
  getLiveTripEtaService,
} from "../services/passengerTracking.service.js";

export async function getLiveBusesByRoute(req: AuthRequest, res: Response) {
  const parsed = uuidParamSchema.safeParse(req.params.routeId);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_ROUTE_ID",
      message: "Invalid routeId",
    });
  }

  const data = await getLiveBusesByRouteService(parsed.data);

  req.log?.info(
    {
      routeId: parsed.data,
      requesterUserId: req.user?.id ?? null,
      activeTrips: data.activeTrips.length,
    },
    "live buses by route fetched",
  );

  return sendSuccess(res, {
    message: "Live buses fetched successfully",
    data,
  });
}

export async function getLiveTripState(req: AuthRequest, res: Response) {
  const parsed = uuidParamSchema.safeParse(req.params.tripId);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_TRIP_ID",
      message: "Invalid tripId",
    });
  }

  const data = await getLiveTripStateService(parsed.data);

  req.log?.info(
    {
      tripId: parsed.data,
      requesterUserId: req.user?.id ?? null,
    },
    "live trip state fetched",
  );

  return sendSuccess(res, {
    message: "Live trip state fetched successfully",
    data,
  });
}

export async function getLiveTripEta(req: AuthRequest, res: Response) {
  const parsed = uuidParamSchema.safeParse(req.params.tripId);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_TRIP_ID",
      message: "Invalid tripId",
    });
  }

  const data = await getLiveTripEtaService(parsed.data);

  req.log?.info(
    {
      tripId: parsed.data,
      requesterUserId: req.user?.id ?? null,
      hasEta: data.eta != null,
    },
    "live trip eta fetched",
  );

  return sendSuccess(res, {
    message:
      data.eta != null
        ? "Live trip ETA fetched successfully"
        : "Live trip ETA is not available yet",
    data,
  });
}
