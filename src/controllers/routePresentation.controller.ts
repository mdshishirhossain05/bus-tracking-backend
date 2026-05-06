import { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { uuidParamSchema } from "../validators/params.validators.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";
import { getRoutePresentationService } from "../services/routePresentation.service.js";

export async function getRoutePresentation(req: AuthRequest, res: Response) {
  const parsed = uuidParamSchema.safeParse(req.params.routeId);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_ROUTE_ID",
      message: "Invalid routeId",
    });
  }

  const data = await getRoutePresentationService(parsed.data);

  return sendSuccess(res, {
    message: "Route presentation fetched successfully",
    data,
  });
}
