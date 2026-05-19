import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  getAdminOperationsOverview,
  getAdminOperationsEvents,
  getAdminTripSourceDiagnostics,
  getAdminActiveTrips,
  getAdminTripOperationsDetail,
  forceEndAdminTrip,
  forceRecoverAdminTrip,
  startAdminTrip,
} from "../../controllers/admin/operations.controller.js";

export const adminOperationsRouter = Router();

/**
 * @openapi
 * /admin/operations/overview:
 *   get:
 *     summary: Get admin operations overview
 *     description: Returns KPI summary and live trip overview for admin dashboard
 *     tags:
 *       - Admin Operations
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Admin operations overview fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
adminOperationsRouter.get(
  "/admin/operations/overview",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(getAdminOperationsOverview),
);

/**
 * @openapi
 * /admin/operations/active-trips:
 *   get:
 *     summary: Get active trips for admin operations
 *     description: Returns active running/planned trips with operational lifecycle metadata for the operations console.
 *     tags:
 *       - Admin Operations
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Admin active trips fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
adminOperationsRouter.get(
  "/admin/operations/active-trips",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(getAdminActiveTrips),
);

/**
 * @openapi
 * /admin/operations/trips/start:
 *   post:
 *     summary: Manually start a trip from a service schedule
 *     tags:
 *       - Admin Operations
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Trip started successfully
 */
adminOperationsRouter.post(
  "/admin/operations/trips/start",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(startAdminTrip),
);

/**
 * @openapi
 * /admin/operations/events:
 *   get:
 *     summary: Get admin operations events
 *     description: Returns persisted operations event feed for admin dashboard
 *     tags:
 *       - Admin Operations
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           example: 30
 *         description: Max number of latest events to return (max 100)
 *     responses:
 *       200:
 *         description: Admin operations events fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
adminOperationsRouter.get(
  "/admin/operations/events",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(getAdminOperationsEvents),
);

/**
 * @openapi
 * /admin/operations/trips/{tripId}:
 *   get:
 *     summary: Get one admin trip operations detail
 *     description: Returns a detailed operational view of one trip including lifecycle metadata, sources, and recent events.
 *     tags:
 *       - Admin Operations
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
 *     responses:
 *       200:
 *         description: Admin trip operations detail fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Trip not found
 */
adminOperationsRouter.get(
  "/admin/operations/trips/:tripId",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(getAdminTripOperationsDetail),
);

/**
 * @openapi
 * /admin/operations/trips/{tripId}/sources:
 *   get:
 *     summary: Get source diagnostics for one trip
 *     description: Returns canonical selected source, driver mobile source state, GPS device source state, assignment context, and freshness/health details for one trip.
 *     tags:
 *       - Admin Operations
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
 *     responses:
 *       200:
 *         description: Trip source diagnostics fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Trip not found
 */
adminOperationsRouter.get(
  "/admin/operations/trips/:tripId/sources",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(getAdminTripSourceDiagnostics),
);

/**
 * @openapi
 * /admin/operations/trips/{tripId}/force-end:
 *   post:
 *     summary: Force end a trip
 *     description: Allows an admin to force-end a running trip using the centralized lifecycle finalization flow.
 *     tags:
 *       - Admin Operations
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
 *     responses:
 *       200:
 *         description: Trip force-ended successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Trip not found
 */
adminOperationsRouter.post(
  "/admin/operations/trips/:tripId/force-end",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(forceEndAdminTrip),
);

/**
 * @openapi
 * /admin/operations/trips/{tripId}/force-recover:
 *   post:
 *     summary: Force recover a trip operational state
 *     description: Allows an admin to recover stuck/stale operational state for a running trip without reopening ended trips.
 *     tags:
 *       - Admin Operations
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
 *     responses:
 *       200:
 *         description: Trip operational state recovered successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Trip not found
 */
adminOperationsRouter.post(
  "/admin/operations/trips/:tripId/force-recover",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(forceRecoverAdminTrip),
);
