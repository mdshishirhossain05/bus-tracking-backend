import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import {
  archiveServiceSchedule,
  createServiceSchedule,
  deleteServiceSchedule,
  getServiceScheduleById,
  listServiceSchedules,
  permanentlyDeleteArchivedServiceSchedule,
  restoreServiceSchedule,
  updateServiceSchedule,
} from "../../controllers/admin/serviceSchedule.controller.js";

export const adminServiceScheduleRouter = Router();

/**
 * @openapi
 * /admin/service-schedules:
 *   post:
 *     summary: Create service schedule
 *     tags:
 *       - Admin Service Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
adminServiceScheduleRouter.post(
  "/admin/service-schedules",
  requireAuth,
  requireRole("ADMIN"),
  createServiceSchedule,
);

/**
 * @openapi
 * /admin/service-schedules:
 *   get:
 *     summary: List service schedules
 *     tags:
 *       - Admin Service Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
adminServiceScheduleRouter.get(
  "/admin/service-schedules",
  requireAuth,
  requireRole("ADMIN"),
  listServiceSchedules,
);

/**
 * @openapi
 * /admin/service-schedules/{id}:
 *   get:
 *     summary: Get service schedule by id
 *     tags:
 *       - Admin Service Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
adminServiceScheduleRouter.get(
  "/admin/service-schedules/:id",
  requireAuth,
  requireRole("ADMIN"),
  getServiceScheduleById,
);

/**
 * @openapi
 * /admin/service-schedules/{id}:
 *   patch:
 *     summary: Update service schedule
 *     tags:
 *       - Admin Service Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
adminServiceScheduleRouter.patch(
  "/admin/service-schedules/:id",
  requireAuth,
  requireRole("ADMIN"),
  updateServiceSchedule,
);

/**
 * @openapi
 * /admin/service-schedules/{id}/archive:
 *   post:
 *     summary: Archive service schedule
 *     tags:
 *       - Admin Service Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
adminServiceScheduleRouter.post(
  "/admin/service-schedules/:id/archive",
  requireAuth,
  requireRole("ADMIN"),
  archiveServiceSchedule,
);

/**
 * @openapi
 * /admin/service-schedules/{id}/restore:
 *   post:
 *     summary: Restore archived service schedule
 *     tags:
 *       - Admin Service Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
adminServiceScheduleRouter.post(
  "/admin/service-schedules/:id/restore",
  requireAuth,
  requireRole("ADMIN"),
  restoreServiceSchedule,
);

/**
 * @openapi
 * /admin/service-schedules/{id}/permanent-delete:
 *   delete:
 *     summary: Permanently delete archived service schedule
 *     tags:
 *       - Admin Service Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
adminServiceScheduleRouter.delete(
  "/admin/service-schedules/:id/permanent-delete",
  requireAuth,
  requireRole("ADMIN"),
  permanentlyDeleteArchivedServiceSchedule,
);

/**
 * @openapi
 * /admin/service-schedules/{id}:
 *   delete:
 *     summary: Delete service schedule
 *     tags:
 *       - Admin Service Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
adminServiceScheduleRouter.delete(
  "/admin/service-schedules/:id",
  requireAuth,
  requireRole("ADMIN"),
  deleteServiceSchedule,
);
