import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import {
  createSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
} from "../../controllers/admin/schedule.controller.js";

export const adminScheduleRouter = Router();

/**
 * @openapi
 * /admin/schedules:
 *   post:
 *     summary: Create schedule
 *     tags:
 *       - Admin Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Schedule created successfully
 */
adminScheduleRouter.post(
  "/admin/schedules",
  requireAuth,
  requireRole("ADMIN"),
  createSchedule,
);

/**
 * @openapi
 * /admin/schedules:
 *   get:
 *     summary: List schedules
 *     tags:
 *       - Admin Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Schedules fetched successfully
 */
adminScheduleRouter.get(
  "/admin/schedules",
  requireAuth,
  requireRole("ADMIN"),
  listSchedules,
);

/**
 * @openapi
 * /admin/schedules/{id}:
 *   patch:
 *     summary: Update schedule
 *     tags:
 *       - Admin Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Schedule updated successfully
 */
adminScheduleRouter.patch(
  "/admin/schedules/:id",
  requireAuth,
  requireRole("ADMIN"),
  updateSchedule,
);

/**
 * @openapi
 * /admin/schedules/{id}:
 *   delete:
 *     summary: Delete schedule
 *     tags:
 *       - Admin Schedule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Schedule deleted successfully
 */
adminScheduleRouter.delete(
  "/admin/schedules/:id",
  requireAuth,
  requireRole("ADMIN"),
  deleteSchedule,
);
