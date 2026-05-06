import { Router } from "express";
import {
  registerPassenger,
  login,
  me,
  updateMe,
  changePassword,
  refresh,
  logout,
  logoutAll,
  listSessions,
  logoutOthers,
  revokeOneSession,
  getPublicRegistrationSettings,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { noStoreResponse } from "../middlewares/cache.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  loginLimiter,
  refreshLimiter,
} from "../middlewares/rateLimit.middleware.js";

export const authRouter = Router();

authRouter.get(
  "/auth/registration-settings",
  noStoreResponse,
  asyncHandler(getPublicRegistrationSettings),
);

authRouter.post("/auth/register", asyncHandler(registerPassenger));
authRouter.post("/auth/login", loginLimiter, asyncHandler(login));
authRouter.get("/auth/me", asyncHandler(requireAuth), asyncHandler(me));
authRouter.patch("/auth/me", asyncHandler(requireAuth), asyncHandler(updateMe));

authRouter.post(
  "/auth/change-password",
  asyncHandler(requireAuth),
  asyncHandler(changePassword),
);

authRouter.post("/auth/refresh", refreshLimiter, asyncHandler(refresh));

authRouter.post(
  "/auth/logout",
  asyncHandler(requireAuth),
  asyncHandler(logout),
);

authRouter.post(
  "/auth/logout-all",
  asyncHandler(requireAuth),
  asyncHandler(logoutAll),
);

authRouter.get(
  "/auth/sessions",
  asyncHandler(requireAuth),
  asyncHandler(listSessions),
);

authRouter.post(
  "/auth/logout-others",
  asyncHandler(requireAuth),
  asyncHandler(logoutOthers),
);

authRouter.delete(
  "/auth/sessions/:sessionId",
  asyncHandler(requireAuth),
  asyncHandler(revokeOneSession),
);
