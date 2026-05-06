import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import {
  createRoute,
  listRoutes,
  updateRoute,
  deleteRoute,
} from "../../controllers/admin/route.controller.js";

export const adminRouteRouter = Router();

/**
 * @openapi
 * /admin/routes:
 *   post:
 *     summary: Create route
 *     tags:
 *       - Admin Route
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
 *         description: Route created successfully
 */
adminRouteRouter.post(
  "/admin/routes",
  requireAuth,
  requireRole("ADMIN"),
  createRoute,
);

/**
 * @openapi
 * /admin/routes:
 *   get:
 *     summary: List routes
 *     tags:
 *       - Admin Route
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Routes fetched successfully
 */
adminRouteRouter.get(
  "/admin/routes",
  requireAuth,
  requireRole("ADMIN"),
  listRoutes,
);

/**
 * @openapi
 * /admin/routes/{id}:
 *   patch:
 *     summary: Update route
 *     tags:
 *       - Admin Route
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Route updated successfully
 */
adminRouteRouter.patch(
  "/admin/routes/:id",
  requireAuth,
  requireRole("ADMIN"),
  updateRoute,
);

/**
 * @openapi
 * /admin/routes/{id}:
 *   delete:
 *     summary: Delete route
 *     tags:
 *       - Admin Route
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
 *         description: Route deleted successfully
 */
adminRouteRouter.delete(
  "/admin/routes/:id",
  requireAuth,
  requireRole("ADMIN"),
  deleteRoute,
);
