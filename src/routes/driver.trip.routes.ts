import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware.js";
import {
  getCurrentTrip,
  startTrip,
  sendLocation,
  endTrip,
} from "../controllers/driverTrip.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const driverTripRouter = Router();

/**
 * @openapi
 * /driver/trips/current:
 *   get:
 *     summary: Get current driver trip
 *     description: Returns the currently running or planned trip assigned to the authenticated driver
 *     tags:
 *       - Driver
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current driver trip fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
driverTripRouter.get(
  "/driver/trips/current",
  requireAuth,
  requireRole("DRIVER"),
  asyncHandler(getCurrentTrip),
);

/**
 * @openapi
 * /driver/trips/start:
 *   post:
 *     summary: Start a new trip
 *     description: Driver starts a trip for a specific bus and route
 *     tags:
 *       - Driver
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *         description: Prevents duplicate trip creation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Trip started successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Trip already running or idempotency conflict
 */
driverTripRouter.post(
  "/driver/trips/start",
  requireAuth,
  requireRole("DRIVER"),
  asyncHandler(startTrip),
);

/**
 * @openapi
 * /driver/trips/{tripId}/location:
 *   post:
 *     summary: Send location update
 *     description: Driver sends GPS location updates during a trip
 *     tags:
 *       - Driver
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lat
 *               - lng
 *             properties:
 *               lat:
 *                 type: number
 *                 example: 23.780573
 *               lng:
 *                 type: number
 *                 example: 90.279239
 *               speedKmh:
 *                 type: number
 *                 example: 32
 *               heading:
 *                 type: integer
 *                 example: 180
 *               accuracyM:
 *                 type: number
 *                 example: 10
 *               recordedAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-03-09T12:00:00Z"
 *     responses:
 *       200:
 *         description: Location accepted
 *       400:
 *         description: Invalid data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not your trip
 *       404:
 *         description: Trip not found
 *       429:
 *         description: Rate limited
 */
driverTripRouter.post(
  "/driver/trips/:tripId/location",
  requireAuth,
  requireRole("DRIVER"),
  asyncHandler(sendLocation),
);

/**
 * @openapi
 * /driver/trips/{tripId}/end:
 *   post:
 *     summary: End a trip
 *     description: Driver ends an active trip
 *     tags:
 *       - Driver
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
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *         description: Prevents duplicate endTrip requests
 *     responses:
 *       200:
 *         description: Trip ended successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not your trip
 *       404:
 *         description: Trip not found
 *       409:
 *         description: Idempotency conflict
 */
driverTripRouter.post(
  "/driver/trips/:tripId/end",
  requireAuth,
  requireRole("DRIVER"),
  asyncHandler(endTrip),
);
