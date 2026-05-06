import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware.js";
import { noStoreResponse } from "../../middlewares/cache.middleware.js";
import {
  adminApprovePassenger,
  adminCreateUser,
  adminDeleteUser,
  adminGetRegistrationSettings,
  adminGetUserById,
  adminListUsers,
  adminRejectPassenger,
  adminSearchUsers,
  adminUpdateRegistrationSettings,
  adminUpdateUser,
  adminUpdateUserRole,
  adminUpdateUserStatus,
  adminUserSessionDashboard,
} from "../../controllers/admin/user.controller.js";

export const adminUserRouter = Router();

adminUserRouter.get(
  "/admin/users/settings/registration",
  requireAuth,
  requireRole("ADMIN"),
  noStoreResponse,
  adminGetRegistrationSettings,
);

adminUserRouter.patch(
  "/admin/users/settings/registration",
  requireAuth,
  requireRole("ADMIN"),
  noStoreResponse,
  adminUpdateRegistrationSettings,
);

adminUserRouter.get(
  "/admin/users",
  requireAuth,
  requireRole("ADMIN"),
  adminListUsers,
);

adminUserRouter.post(
  "/admin/users",
  requireAuth,
  requireRole("ADMIN"),
  adminCreateUser,
);

adminUserRouter.get(
  "/admin/users/search",
  requireAuth,
  requireRole("ADMIN"),
  adminSearchUsers,
);

adminUserRouter.get(
  "/admin/users/:id",
  requireAuth,
  requireRole("ADMIN"),
  adminGetUserById,
);

adminUserRouter.patch(
  "/admin/users/:id",
  requireAuth,
  requireRole("ADMIN"),
  adminUpdateUser,
);

adminUserRouter.patch(
  "/admin/users/:id/role",
  requireAuth,
  requireRole("ADMIN"),
  adminUpdateUserRole,
);

adminUserRouter.patch(
  "/admin/users/:id/status",
  requireAuth,
  requireRole("ADMIN"),
  adminUpdateUserStatus,
);

adminUserRouter.patch(
  "/admin/users/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  adminApprovePassenger,
);

adminUserRouter.patch(
  "/admin/users/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  adminRejectPassenger,
);

adminUserRouter.delete(
  "/admin/users/:id",
  requireAuth,
  requireRole("ADMIN"),
  adminDeleteUser,
);

adminUserRouter.get(
  "/admin/users/:userId/session-dashboard",
  requireAuth,
  requireRole("ADMIN"),
  adminUserSessionDashboard,
);
