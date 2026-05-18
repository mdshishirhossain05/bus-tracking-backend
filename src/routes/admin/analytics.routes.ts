import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  getAdminDelayReport,
  getAdminAnalyticsOverview,
} from "../../controllers/admin/analytics.controller.js";

export const adminAnalyticsRouter = Router();

/**
 * @openapi
 * /admin/analytics/overview:
 *   get:
 *     summary: Admin analytics overview
 *     description: Aggregate trip, route and arrival statistics for the admin analytics dashboard.
 *     tags:
 *       - Admin Operations
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Analytics overview fetched successfully
 */
adminAnalyticsRouter.get(
  "/admin/analytics/overview",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(getAdminAnalyticsOverview),
);

/**
 * @openapi
 * /admin/analytics/delays:
 *   get:
 *     summary: Stop-arrival delay report
 *     description: Returns delay summary statistics and a paginated arrival list.
 *     tags:
 *       - Admin Operations
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Delay report fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
adminAnalyticsRouter.get(
  "/admin/analytics/delays",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(getAdminDelayReport),
);
