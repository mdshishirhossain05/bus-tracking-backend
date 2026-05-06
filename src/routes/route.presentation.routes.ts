import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getRoutePresentation } from "../controllers/routePresentation.controller.js";

export const routePresentationRouter = Router();

/**
 * @openapi
 * /routes/{routeId}/presentation:
 *   get:
 *     summary: Get route presentation
 *     description: Returns route polyline and ordered stop list for map rendering
 *     tags:
 *       - Routes
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
 *         description: Route identifier
 *     responses:
 *       200:
 *         description: Route presentation fetched successfully
 *       400:
 *         description: Invalid routeId
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Route not found
 */
routePresentationRouter.get(
  "/routes/:routeId/presentation",
  requireAuth,
  requireRole("ADMIN", "DRIVER", "PASSENGER"),
  asyncHandler(getRoutePresentation),
);
