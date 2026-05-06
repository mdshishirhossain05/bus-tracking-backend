import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";

export const adminTestRouter = Router();

/**
 * @openapi
 * /admin/test:
 *   get:
 *     summary: Admin test route
 *     tags:
 *       - Admin Test
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Admin access granted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
adminTestRouter.get(
  "/admin/test",
  requireAuth,
  requireRole("ADMIN"),
  (_req, res) => {
    res.json({ message: "Admin access granted" });
  },
);
