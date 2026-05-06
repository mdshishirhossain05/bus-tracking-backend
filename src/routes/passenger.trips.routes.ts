import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listActiveTrips } from "../controllers/passengerTrips.controller.js";

export const passengerTripsRouter = Router();

/**
 * @openapi
 * /passenger/trips/active:
 *   get:
 *     summary: List active trips
 *     description: Returns all currently active running trips available to passengers.
 *     tags:
 *       - Passenger
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Active trips retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
passengerTripsRouter.get(
  "/passenger/trips/active",
  asyncHandler(requireAuth),
  requireRole("PASSENGER", "ADMIN"),
  asyncHandler(listActiveTrips),
);
