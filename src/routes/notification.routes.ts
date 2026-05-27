import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerPushToken,
  removePushToken,
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
