import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import {
  getRouteWithStops,
  setRouteStops,
} from "../../controllers/routeStop.controller.js";

export const adminRouteStopRouter = Router();

/**
 * @openapi
 * /admin/routes/{routeId}/stops:
 *   get:
 *     summary: Get route with stops
 *     tags:
 *       - Admin Route Stop
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Route stops fetched successfully
 */
adminRouteStopRouter.get(
  "/admin/routes/:routeId/stops",
  requireAuth,
  requireRole("ADMIN"),
  getRouteWithStops,
);

/**
 * @openapi
 * /admin/routes/{routeId}/stops:
 *   put:
 *     summary: Set route stops
 *     tags:
 *       - Admin Route Stop
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
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
 *         description: Route stops updated successfully
 */
adminRouteStopRouter.put(
  "/admin/routes/:routeId/stops",
  requireAuth,
  requireRole("ADMIN"),
  setRouteStops,
);
