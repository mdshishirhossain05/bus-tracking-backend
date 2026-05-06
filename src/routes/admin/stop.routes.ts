import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import {
  createStop,
  listStops,
  getStopUsage,
  updateStop,
  deleteStop,
} from "../../controllers/admin/stop.controller.js";

export const adminStopRouter = Router();

adminStopRouter.post(
  "/admin/stops",
  requireAuth,
  requireRole("ADMIN"),
  createStop,
);

adminStopRouter.get(
  "/admin/stops",
  requireAuth,
  requireRole("ADMIN"),
  listStops,
);

adminStopRouter.get(
  "/admin/stops/:id/usage",
  requireAuth,
  requireRole("ADMIN"),
  getStopUsage,
);

adminStopRouter.patch(
  "/admin/stops/:id",
  requireAuth,
  requireRole("ADMIN"),
  updateStop,
);

adminStopRouter.delete(
  "/admin/stops/:id",
  requireAuth,
  requireRole("ADMIN"),
  deleteStop,
);
