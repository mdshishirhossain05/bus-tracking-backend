import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import {
  createBus,
  listBuses,
  updateBus,
  deleteBus,
  createGpsDevice,
  listGpsDevices,
  updateGpsDevice,
  deleteGpsDevice,
  getGpsDeviceTraccarStatus,
  reconcileGpsDeviceWithTraccar,
  getBusGpsDeviceAssignment,
  assignGpsDeviceToBus,
  unassignGpsDeviceFromBus,
} from "../../controllers/admin/bus.controller.js";

export const adminBusRouter = Router();

adminBusRouter.post(
  "/admin/buses",
  requireAuth,
  requireRole("ADMIN"),
  createBus,
);

adminBusRouter.get(
  "/admin/buses",
  requireAuth,
  requireRole("ADMIN"),
  listBuses,
);

adminBusRouter.patch(
  "/admin/buses/:id",
  requireAuth,
  requireRole("ADMIN"),
  updateBus,
);

adminBusRouter.delete(
  "/admin/buses/:id",
  requireAuth,
  requireRole("ADMIN"),
  deleteBus,
);

adminBusRouter.post(
  "/admin/gps-devices",
  requireAuth,
  requireRole("ADMIN"),
  createGpsDevice,
);

adminBusRouter.get(
  "/admin/gps-devices",
  requireAuth,
  requireRole("ADMIN"),
  listGpsDevices,
);

adminBusRouter.patch(
  "/admin/gps-devices/:id",
  requireAuth,
  requireRole("ADMIN"),
  updateGpsDevice,
);

adminBusRouter.delete(
  "/admin/gps-devices/:id",
  requireAuth,
  requireRole("ADMIN"),
  deleteGpsDevice,
);

adminBusRouter.get(
  "/admin/gps-devices/:id/traccar/status",
  requireAuth,
  requireRole("ADMIN"),
  getGpsDeviceTraccarStatus,
);

adminBusRouter.post(
  "/admin/gps-devices/:id/traccar/reconcile",
  requireAuth,
  requireRole("ADMIN"),
  reconcileGpsDeviceWithTraccar,
);

adminBusRouter.get(
  "/admin/buses/:id/gps-device",
  requireAuth,
  requireRole("ADMIN"),
  getBusGpsDeviceAssignment,
);

adminBusRouter.post(
  "/admin/buses/:id/gps-device/assign",
  requireAuth,
  requireRole("ADMIN"),
  assignGpsDeviceToBus,
);

adminBusRouter.post(
  "/admin/buses/:id/gps-device/unassign",
  requireAuth,
  requireRole("ADMIN"),
  unassignGpsDeviceFromBus,
);
