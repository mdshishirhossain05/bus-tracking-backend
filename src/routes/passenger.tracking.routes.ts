import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getLiveBusesByRoute,
  getLiveTripState,
  getLiveTripEta,
} from "../controllers/passengerTracking.controller.js";

export const passengerTrackingRouter = Router();

/**
 * @openapi
 * /passenger/routes/{routeId}/live-buses:
 *   get:
 *     summary: Get live buses by route
 *     description: Returns currently running buses for a specific route with latest live location and ETA information.
 *     tags:
 *       - Passenger Tracking
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
 *         description: Live buses fetched successfully
 *       400:
 *         description: Invalid routeId
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Route not found
 */
passengerTrackingRouter.get(
  "/passenger/routes/:routeId/live-buses",
  requireAuth,
  requireRole("PASSENGER", "ADMIN", "DRIVER"),
  asyncHandler(getLiveBusesByRoute),
);

/**
 * @openapi
 * /passenger/trips/{tripId}/live:
 *   get:
 *     summary: Get live trip state
 *     description: Returns current live state of a trip including bus, route, driver, latest location, and ETA.
 *     tags:
 *       - Passenger Tracking
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: tripId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Trip identifier
 *     responses:
 *       200:
 *         description: Live trip state fetched successfully
 *       400:
 *         description: Invalid tripId
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Trip not found
 */
passengerTrackingRouter.get(
  "/passenger/trips/:tripId/live",
  requireAuth,
  requireRole("PASSENGER", "ADMIN", "DRIVER"),
  asyncHandler(getLiveTripState),
);

/**
 * @openapi
 * /passenger/trips/{tripId}/eta:
 *   get:
 *     summary: Get live trip ETA
 *     description: Returns current ETA information for a running trip based on its latest saved location.
 *     tags:
 *       - Passenger Tracking
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: tripId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Trip identifier
 *     responses:
 *       200:
 *         description: Live trip ETA fetched successfully
 *       400:
 *         description: Invalid tripId
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Trip or live location not found
 */
passengerTrackingRouter.get(
  "/passenger/trips/:tripId/eta",
  requireAuth,
  requireRole("PASSENGER", "ADMIN", "DRIVER"),
  asyncHandler(getLiveTripEta),
);
