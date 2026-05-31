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
import {
  getNotificationPreferencesService,
  updateNotificationPreferencesService,
} from "../services/notificationPreferences.service.js";
import {
  deleteStopSubscriptionService,
  listStopSubscriptionsService,
  toggleStopSubscriptionService,
  upsertStopSubscriptionService,
} from "../services/stopSubscription.service.js";

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

export async function getNotificationPreferences(
  req: AuthRequest,
  res: Response,
) {
  const data = await getNotificationPreferencesService(requireUserId(req));
  return sendSuccess(res, {
    message: "Notification preferences fetched",
    data,
  });
}

export async function updateNotificationPreferences(
  req: AuthRequest,
  res: Response,
) {
  const body = req.body ?? {};
  const data = await updateNotificationPreferencesService(requireUserId(req), {
    notificationsEnabled:
      typeof body.notificationsEnabled === "boolean"
        ? body.notificationsEnabled
        : undefined,
    quietHoursStartMin:
      body.quietHoursStartMin === null
        ? null
        : typeof body.quietHoursStartMin === "number"
          ? body.quietHoursStartMin
          : undefined,
    quietHoursEndMin:
      body.quietHoursEndMin === null
        ? null
        : typeof body.quietHoursEndMin === "number"
          ? body.quietHoursEndMin
          : undefined,
  });
  return sendSuccess(res, {
    message: "Notification preferences updated",
    data,
  });
}

export async function listStopSubscriptions(req: AuthRequest, res: Response) {
  const items = await listStopSubscriptionsService(requireUserId(req));
  return sendSuccess(res, {
    message: "Stop subscriptions fetched",
    data: { items },
  });
}

export async function upsertStopSubscription(
  req: AuthRequest,
  res: Response,
) {
  const body = req.body ?? {};
  const stopId = typeof body.stopId === "string" ? body.stopId : "";
  const routeId = typeof body.routeId === "string" ? body.routeId : "";
  if (!stopId || !routeId) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_BODY",
      message: "stopId and routeId are required",
    });
  }
  const leadTimeMinutes =
    typeof body.leadTimeMinutes === "number" ? body.leadTimeMinutes : undefined;
  const subscription = await upsertStopSubscriptionService(requireUserId(req), {
    stopId,
    routeId,
    leadTimeMinutes,
  });
  return sendSuccess(res, {
    message: "Stop subscription saved",
    data: subscription,
  });
}

function paramString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function toggleStopSubscription(
  req: AuthRequest,
  res: Response,
) {
  const userId = requireUserId(req);
  const stopId = paramString(req.params.stopId);
  const routeId = paramString(req.params.routeId);
  const enabled = req.body?.enabled !== false;
  if (!stopId || !routeId) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_PARAMS",
      message: "stopId and routeId path params are required",
    });
  }
  const subscription = await toggleStopSubscriptionService(
    userId,
    stopId,
    routeId,
    enabled,
  );
  return sendSuccess(res, {
    message: "Stop subscription updated",
    data: subscription,
  });
}

export async function deleteStopSubscription(
  req: AuthRequest,
  res: Response,
) {
  const userId = requireUserId(req);
  const stopId = paramString(req.params.stopId);
  const routeId = paramString(req.params.routeId);
  if (!stopId || !routeId) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_PARAMS",
      message: "stopId and routeId path params are required",
    });
  }
  await deleteStopSubscriptionService(userId, stopId, routeId);
  return sendSuccess(res, {
    message: "Stop subscription removed",
    data: { removed: true },
  });
}
