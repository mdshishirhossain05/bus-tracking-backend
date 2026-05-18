import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  listFavoriteRoutes,
  addFavoriteRoute,
  removeFavoriteRoute,
} from "../controllers/favorite.controller.js";

export const favoriteRouter = Router();

/**
 * @openapi
 * /passenger/favorites:
 *   get:
 *     summary: List the signed-in passenger's favorite routes
 *     tags:
 *       - Passenger
 *     security:
 *       - cookieAuth: []
 *   post:
 *     summary: Add a route to favorites
 *     tags:
 *       - Passenger
 *     security:
 *       - cookieAuth: []
 */
favoriteRouter.get(
  "/passenger/favorites",
  asyncHandler(requireAuth),
  requireRole("PASSENGER", "ADMIN"),
  asyncHandler(listFavoriteRoutes),
);

favoriteRouter.post(
  "/passenger/favorites",
  asyncHandler(requireAuth),
  requireRole("PASSENGER", "ADMIN"),
  asyncHandler(addFavoriteRoute),
);

favoriteRouter.delete(
  "/passenger/favorites/:routeId",
  asyncHandler(requireAuth),
  requireRole("PASSENGER", "ADMIN"),
  asyncHandler(removeFavoriteRoute),
);
