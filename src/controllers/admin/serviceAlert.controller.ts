import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { sendSuccess } from "../../utils/apiResponse.js";
import { AppError } from "../../utils/appError.js";
import {
  createAlertService,
  deleteAlertService,
  listAllAlertsService,
  updateAlertService,
} from "../../services/serviceAlert.service.js";

function paramString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function listAlertsAdmin(_req: AuthRequest, res: Response) {
  const items = await listAllAlertsService();
  return sendSuccess(res, {
    message: "Alerts fetched",
    data: { items },
  });
}

export async function createAlert(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  const alert = await createAlertService(userId, req.body ?? {});
  return sendSuccess(res, {
    message: "Alert created",
    data: alert,
  });
}

export async function updateAlert(req: AuthRequest, res: Response) {
  const id = paramString(req.params.id);
  if (!id) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_PARAMS",
      message: "id is required",
    });
  }
  const alert = await updateAlertService(id, req.body ?? {});
  return sendSuccess(res, {
    message: "Alert updated",
    data: alert,
  });
}

export async function deleteAlert(req: AuthRequest, res: Response) {
  const id = paramString(req.params.id);
  if (!id) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_PARAMS",
      message: "id is required",
    });
  }
  await deleteAlertService(id);
  return sendSuccess(res, {
    message: "Alert deleted",
    data: { deleted: true },
  });
}
