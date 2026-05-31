import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerPushToken,
  removePushToken,
  getNotificationPreferences,
  updateNotificationPreferences,
  listStopSubscriptions,
  upsertStopSubscription,
  toggleStopSubscription,
  deleteStopSubscription,
} from "../controllers/notification.controller.js";

export const notificationRouter = Router();

/**
 * @openapi
 * /notifications:
 *   get:
 *     summary: List the signed-in user's recent notifications
 *     tags:
 *       - Notifications
 *     security:
 *       - cookieAuth: []
 */
notificationRouter.get(
  "/notifications",
  asyncHandler(requireAuth),
  asyncHandler(listNotifications),
);

notificationRouter.post(
  "/notifications/read-all",
  asyncHandler(requireAuth),
  asyncHandler(markAllNotificationsRead),
);

notificationRouter.post(
  "/notifications/:id/read",
  asyncHandler(requireAuth),
  asyncHandler(markNotificationRead),
);

notificationRouter.post(
  "/notifications/push-token",
  asyncHandler(requireAuth),
  asyncHandler(registerPushToken),
);

notificationRouter.delete(
  "/notifications/push-token",
  asyncHandler(requireAuth),
  asyncHandler(removePushToken),
);

notificationRouter.get(
  "/notifications/preferences",
  asyncHandler(requireAuth),
  asyncHandler(getNotificationPreferences),
);

notificationRouter.put(
  "/notifications/preferences",
  asyncHandler(requireAuth),
  asyncHandler(updateNotificationPreferences),
);

notificationRouter.get(
  "/notifications/subscriptions",
  asyncHandler(requireAuth),
  asyncHandler(listStopSubscriptions),
);

notificationRouter.post(
  "/notifications/subscriptions",
  asyncHandler(requireAuth),
  asyncHandler(upsertStopSubscription),
);

notificationRouter.put(
  "/notifications/subscriptions/:routeId/:stopId",
  asyncHandler(requireAuth),
  asyncHandler(toggleStopSubscription),
);

notificationRouter.delete(
  "/notifications/subscriptions/:routeId/:stopId",
  asyncHandler(requireAuth),
  asyncHandler(deleteStopSubscription),
);
