import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  startRouteVisit,
  endRouteVisit,
  listVisitHistory,
  getVisitStats,
  voteOccupancy,
  getOccupancy,
  listAlerts,
} from "../controllers/passengerCompanion.controller.js";

export const passengerCompanionRouter = Router();

passengerCompanionRouter.post(
  "/passenger/visits",
  requireAuth,
  requireRole("PASSENGER", "ADMIN"),
  asyncHandler(startRouteVisit),
);

passengerCompanionRouter.post(
  "/passenger/visits/:visitId/end",
  requireAuth,
  requireRole("PASSENGER", "ADMIN"),
  asyncHandler(endRouteVisit),
);

passengerCompanionRouter.get(
  "/passenger/visits",
  requireAuth,
  requireRole("PASSENGER", "ADMIN"),
  asyncHandler(listVisitHistory),
);

passengerCompanionRouter.get(
  "/passenger/stats",
  requireAuth,
  requireRole("PASSENGER", "ADMIN"),
  asyncHandler(getVisitStats),
);

passengerCompanionRouter.post(
  "/passenger/trips/:tripId/occupancy",
  requireAuth,
  requireRole("PASSENGER", "ADMIN"),
  asyncHandler(voteOccupancy),
);

passengerCompanionRouter.get(
  "/passenger/trips/:tripId/occupancy",
  requireAuth,
  requireRole("PASSENGER", "ADMIN", "DRIVER"),
  asyncHandler(getOccupancy),
);

passengerCompanionRouter.get(
  "/passenger/alerts",
  requireAuth,
  requireRole("PASSENGER", "ADMIN", "DRIVER"),
  asyncHandler(listAlerts),
);
