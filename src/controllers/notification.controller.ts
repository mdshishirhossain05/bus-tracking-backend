import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";
import { uuidParamSchema } from "../validators/params.validators.js";
import {
  listNotificationsService,
  markAllNotificationsReadService,
  markNotificationReadService,
} from "../services/notification.service.js";

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

export async function listNotifications(req: AuthRequest, res: Response) {
  const data = await listNotificationsService(requireUserId(req));
  return sendSuccess(res, {
    message: "Notifications fetched successfully",
    data,
  });
}

export async function markAllNotificationsRead(
  req: AuthRequest,
  res: Response,
) {
  const data = await markAllNotificationsReadService(requireUserId(req));
  return sendSuccess(res, {
    message: "All notifications marked as read",
    data,
  });
}

export async function markNotificationRead(req: AuthRequest, res: Response) {
  const parsed = uuidParamSchema.safeParse(req.params.id);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_ID",
      message: "Invalid notification id",
    });
  }

  const data = await markNotificationReadService(
    requireUserId(req),
    parsed.data,
  );
  return sendSuccess(res, {
    message: "Notification marked as read",
    data,
  });
}
