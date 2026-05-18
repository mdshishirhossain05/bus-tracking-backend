import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { getAdminDelayReport } from "../../controllers/admin/analytics.controller.js";

export const adminAnalyticsRouter = Router();

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
