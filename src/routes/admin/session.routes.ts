import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import {
  adminListUserSessions,
  adminDeleteSession,
} from "../../controllers/admin/session.controller.js";

export const adminSessionRouter = Router();

/**
 * @openapi
 * /admin/users/{userId}/sessions:
 *   get:
 *     summary: List user sessions
 *     tags:
 *       - Admin Session
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User sessions fetched successfully
 */
adminSessionRouter.get(
  "/admin/users/:userId/sessions",
  requireAuth,
  requireRole("ADMIN"),
  adminListUserSessions,
);

/**
 * @openapi
 * /admin/sessions/{sessionId}:
 *   delete:
 *     summary: Delete session
 *     tags:
 *       - Admin Session
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session deleted successfully
 */
adminSessionRouter.delete(
  "/admin/sessions/:sessionId",
  requireAuth,
  requireRole("ADMIN"),
  adminDeleteSession,
);
