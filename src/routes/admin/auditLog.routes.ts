import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { getAdminAuditLogs } from "../../controllers/admin/auditLog.controller.js";

export const adminAuditLogRouter = Router();

/**
 * @openapi
 * /admin/audit-logs:
 *   get:
 *     summary: List audit logs
 *     description: Returns a paginated, filterable feed of recorded audit events.
 *     tags:
 *       - Admin Operations
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Audit logs fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
adminAuditLogRouter.get(
  "/admin/audit-logs",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(getAdminAuditLogs),
);
