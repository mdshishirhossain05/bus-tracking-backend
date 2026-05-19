import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";
import { addFavoriteRouteSchema } from "../validators/favorite.validators.js";
import { uuidParamSchema } from "../validators/params.validators.js";
import {
  listFavoriteRoutesService,
  addFavoriteRouteService,
  removeFavoriteRouteService,
} from "../services/favorite.service.js";

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

export async function listFavoriteRoutes(req: AuthRequest, res: Response) {
  const items = await listFavoriteRoutesService(requireUserId(req));
  return sendSuccess(res, {
    message: "Favorite routes fetched successfully",
    data: { items },
  });
}

export async function addFavoriteRoute(req: AuthRequest, res: Response) {
  const parsed = addFavoriteRouteSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_BODY",
      message: "A valid routeId is required",
      details: parsed.error.format(),
    });
  }

  const items = await addFavoriteRouteService(
    requireUserId(req),
    parsed.data.routeId,
  );
  return sendSuccess(res, {
    message: "Route added to favorites",
    data: { items },
  });
}

export async function removeFavoriteRoute(req: AuthRequest, res: Response) {
  const parsed = uuidParamSchema.safeParse(req.params.routeId);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_ID",
      message: "Invalid routeId",
    });
  }

  const items = await removeFavoriteRouteService(
    requireUserId(req),
    parsed.data,
  );
  return sendSuccess(res, {
    message: "Route removed from favorites",
    data: { items },
  });
}
