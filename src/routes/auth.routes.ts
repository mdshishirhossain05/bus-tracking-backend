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
  requestPassengerRegistrationOtp,
  verifyPassengerRegistrationOtp,
} from "../controllers/auth.controller.js";
import {
  requestPasswordReset,
  verifyPasswordResetOtp,
  resetPassword,
} from "../controllers/passwordReset.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { noStoreResponse } from "../middlewares/cache.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  loginLimiter,
  refreshLimiter,
  forgotPasswordLimiter,
} from "../middlewares/rateLimit.middleware.js";

export const authRouter = Router();

authRouter.get(
  "/auth/registration-settings",
  noStoreResponse,
  asyncHandler(getPublicRegistrationSettings),
);

authRouter.post(
  "/auth/register/request-otp",
  asyncHandler(requestPassengerRegistrationOtp),
);

authRouter.post(
  "/auth/register/verify-otp",
  asyncHandler(verifyPassengerRegistrationOtp),
);

authRouter.post("/auth/register", asyncHandler(registerPassenger));

authRouter.post(
  "/auth/forgot-password/request",
  forgotPasswordLimiter,
  asyncHandler(requestPasswordReset),
);

authRouter.post(
  "/auth/forgot-password/verify",
  asyncHandler(verifyPasswordResetOtp),
);

authRouter.post("/auth/reset-password", asyncHandler(resetPassword));

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
