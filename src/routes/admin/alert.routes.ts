import { Router } from "express";
import {
  requireAuth,
  requireRole,
} from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  listAlertsAdmin,
  createAlert,
  updateAlert,
  deleteAlert,
} from "../../controllers/admin/serviceAlert.controller.js";

export const adminAlertRouter = Router();

adminAlertRouter.get(
  "/admin/alerts",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(listAlertsAdmin),
);

adminAlertRouter.post(
  "/admin/alerts",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(createAlert),
);

adminAlertRouter.put(
  "/admin/alerts/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(updateAlert),
);

adminAlertRouter.delete(
  "/admin/alerts/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(deleteAlert),
);
