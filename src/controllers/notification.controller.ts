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
import {
  registerPushTokenService,
  removePushTokenService,
} from "../services/pushNotification.service.js";

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

export async function registerPushToken(req: AuthRequest, res: Response) {
  const token =
    typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_BODY",
      message: "A valid Expo push token is required",
    });
  }

  const result = await registerPushTokenService({
    userId: requireUserId(req),
    token,
    platform:
      typeof req.body?.platform === "string" ? req.body.platform : null,
    deviceName:
      typeof req.body?.deviceName === "string" ? req.body.deviceName : null,
  });

  if (!result.ok) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_PUSH_TOKEN",
      message: "Push token is not a valid Expo push token",
    });
  }

  return sendSuccess(res, {
    message: "Push token registered",
    data: { registered: true },
  });
}

export async function removePushToken(req: AuthRequest, res: Response) {
  const token =
    typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (token) {
    await removePushTokenService(requireUserId(req), token);
  }
  return sendSuccess(res, {
    message: "Push token removed",
    data: { removed: true },
  });
}
