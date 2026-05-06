import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import {
  registerPassengerSchema,
  loginSchema,
  updateMeSchema,
  changePasswordSchema,
} from "../validators/auth.validators.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { setAuthCookies, clearAuthCookies } from "../utils/cookies.js";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import {
  createSessionAndTokens,
  rotateRefreshToken,
  revokeSession,
  revokeAllUserSessions,
  revokeOtherSessions,
  listUserSessions,
  revokeUserSession,
  RefreshTokenError,
} from "../services/auth.service.js";
import { writeAuditLogSafe, getRequestIp } from "../services/audit.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";

async function readRegistrationSettings() {
  return prisma.appConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      passengerSelfRegistrationEnabled: true,
    },
    update: {},
    select: {
      passengerSelfRegistrationEnabled: true,
      updatedAt: true,
    },
  });
}

export async function getPublicRegistrationSettings(
  _req: Request,
  res: Response,
) {
  const config = await readRegistrationSettings();

  return sendSuccess(res, {
    message: "Registration settings fetched successfully",
    data: config,
  });
}

export async function registerPassenger(req: Request, res: Response) {
  const config = await readRegistrationSettings();

  if (!config.passengerSelfRegistrationEnabled) {
    throw new AppError({
      statusCode: 403,
      code: "PASSENGER_SELF_REGISTRATION_DISABLED",
      message: "Passenger self-registration is currently disabled",
    });
  }

  const parsed = registerPassengerSchema.safeParse(req.body);
  if (!parsed.success) {
    req.log?.warn(
      { errors: parsed.error.format() },
      "registerPassenger validation failed",
    );

    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid data",
      details: parsed.error.format(),
    });
  }

  const { fullName, email, password, studentId, phoneNumber } = parsed.data;

  try {
    const existingEmail = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });

    if (existingEmail) {
      throw new AppError({
        statusCode: 409,
        code: "EMAIL_ALREADY_EXISTS",
        message: "Email already exists",
      });
    }

    const existingStudentId = await prisma.user.findFirst({
      where: { studentId },
      select: { id: true },
    });

    if (existingStudentId) {
      throw new AppError({
        statusCode: 409,
        code: "STUDENT_ID_ALREADY_EXISTS",
        message: "Student ID already exists",
      });
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        fullName,
        email: email.toLowerCase(),
        passwordHash,
        role: "PASSENGER",
        studentId,
        phoneNumber: phoneNumber ?? null,
        isActive: false,
        approvalStatus: "PENDING_APPROVAL",
        registrationSource: "SELF",
        approvedAt: null,
        approvedByUserId: null,
        rejectedAt: null,
        rejectedByUserId: null,
        rejectionReason: null,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        studentId: true,
        phoneNumber: true,
        approvalStatus: true,
        registrationSource: true,
        isActive: true,
        createdAt: true,
      },
    });

    await writeAuditLogSafe({
      actorUserId: user.id,
      actorRole: user.role,
      action: "PASSENGER_SELF_REGISTERED",
      entityType: "User",
      entityId: user.id,
      route: req.originalUrl,
      method: req.method,
      requestId: req.requestId ?? null,
      ip: getRequestIp(req),
      userAgent: req.headers["user-agent"]?.toString() ?? null,
      afterJson: {
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        studentId: user.studentId,
        phoneNumber: user.phoneNumber,
        approvalStatus: user.approvalStatus,
        registrationSource: user.registrationSource,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
      },
    });

    return sendSuccess(res, {
      statusCode: 201,
      message:
        "Passenger registration submitted successfully. Awaiting admin approval.",
      data: { user },
    });
  } catch (err) {
    req.log?.error(
      { err, email, fullName, studentId, requestId: req.requestId ?? null },
      "registerPassenger failed",
    );
    throw err;
  }
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid data",
      details: parsed.error.format(),
    });
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    throw new AppError({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid credentials",
    });
  }

  if (user.role === "PASSENGER" && user.approvalStatus === "PENDING_APPROVAL") {
    throw new AppError({
      statusCode: 403,
      code: "PASSENGER_PENDING_APPROVAL",
      message: "Your passenger account is pending admin approval",
    });
  }

  if (user.role === "PASSENGER" && user.approvalStatus === "REJECTED") {
    throw new AppError({
      statusCode: 403,
      code: "PASSENGER_REGISTRATION_REJECTED",
      message: user.rejectionReason?.trim()
        ? `Your passenger registration was rejected: ${user.rejectionReason}`
        : "Your passenger registration was rejected",
    });
  }

  if (!user.isActive) {
    throw new AppError({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid credentials",
    });
  }

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) {
    throw new AppError({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid credentials",
    });
  }

  const tokens = await createSessionAndTokens({
    req,
    userId: user.id,
    role: user.role,
  });

  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

  await writeAuditLogSafe({
    actorUserId: user.id,
    actorRole: user.role,
    action: "LOGIN_SUCCESS",
    entityType: "Session",
    entityId: tokens.sessionId,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    metaJson: {
      email: user.email,
      sessionId: tokens.sessionId,
      familyId: tokens.familyId,
    },
  });

  return sendSuccess(res, {
    message: "Login successful",
    data: {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        approvalStatus: user.approvalStatus,
        registrationSource: user.registrationSource,
        createdAt: user.createdAt,
      },
    },
  });
}

export async function refresh(req: Request, res: Response) {
  const token = (req as any).cookies?.refresh_token;
  if (!token) {
    throw new AppError({
      statusCode: 401,
      code: "NO_REFRESH_TOKEN",
      message: "No refresh token",
    });
  }

  try {
    const tokens = await rotateRefreshToken({ req, refreshToken: token });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return sendSuccess(res, {
      message: "Token refreshed successfully",
    });
  } catch (err: unknown) {
    clearAuthCookies(res);

    if (err instanceof RefreshTokenError) {
      throw new AppError({
        statusCode: 401,
        code: err.code,
        message: "Refresh failed",
      });
    }

    throw new AppError({
      statusCode: 401,
      code: "UNKNOWN_REFRESH_ERROR",
      message: "Refresh failed",
    });
  }
}

export async function me(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      studentId: true,
      phoneNumber: true,
      approvalStatus: true,
      registrationSource: true,
      createdAt: true,
    },
  });

  return sendSuccess(res, {
    message: "Current user fetched successfully",
    data: { user },
  });
}

export async function updateMe(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid data",
      details: parsed.error.format(),
    });
  }

  const { fullName, email, phoneNumber } = parsed.data;

  const existingEmailOwner = await prisma.user.findFirst({
    where: {
      email: email.toLowerCase(),
      NOT: { id: userId },
    },
    select: { id: true },
  });

  if (existingEmailOwner) {
    throw new AppError({
      statusCode: 409,
      code: "EMAIL_ALREADY_EXISTS",
      message: "Email already exists",
    });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      fullName,
      email: email.toLowerCase(),
      phoneNumber: phoneNumber?.trim() || null,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      studentId: true,
      phoneNumber: true,
      approvalStatus: true,
      registrationSource: true,
      createdAt: true,
    },
  });

  return sendSuccess(res, {
    message: "Profile updated successfully",
    data: { user },
  });
}

export async function changePassword(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  const currentSessionId = req.user?.sessionId;

  if (!userId || !currentSessionId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid data",
      details: parsed.error.format(),
    });
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError({
      statusCode: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  }

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_CURRENT_PASSWORD",
      message: "Current password is incorrect",
    });
  }

  const nextPasswordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: nextPasswordHash },
  });

  await revokeOtherSessions(
    userId,
    currentSessionId,
    "PASSWORD_CHANGED_LOGOUT_OTHERS",
  );

  return sendSuccess(res, {
    message: "Password changed successfully",
  });
}

export async function listSessions(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  const currentSessionId = req.user?.sessionId;

  if (!userId || !currentSessionId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  const sessions = await listUserSessions(userId);

  return sendSuccess(res, {
    message: "Sessions fetched successfully",
    data: {
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        userAgentRaw: s.userAgentRaw,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        ipFirst: s.ipFirst,
        ipLast: s.ipLast,
        lastSeenIp: s.lastSeenIp,
        refreshFamilyId: s.refreshFamilyId,
        current: s.id === currentSessionId,
        revokedAt: s.revokedAt,
        revokedReason: s.revokedReason,
      })),
    },
  });
}

export async function logout(req: AuthRequest, res: Response) {
  const sessionId = req.user?.sessionId;
  if (sessionId) {
    await revokeSession(sessionId, "LOGOUT");
  }

  clearAuthCookies(res);

  return sendSuccess(res, {
    message: "Logged out successfully",
  });
}

export async function logoutAll(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  await revokeAllUserSessions(userId, "LOGOUT_ALL");
  clearAuthCookies(res);

  return sendSuccess(res, {
    message: "Logged out from all devices",
  });
}

export async function logoutOthers(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  const currentSessionId = req.user?.sessionId;

  if (!userId || !currentSessionId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  await revokeOtherSessions(userId, currentSessionId, "LOGOUT_OTHERS");

  return sendSuccess(res, {
    message: "Logged out from other devices",
  });
}

export async function revokeOneSession(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  const currentSessionId = req.user?.sessionId;
  const sessionId = req.params.sessionId;

  if (!userId || !currentSessionId) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_SESSION_ID",
      message: "Invalid sessionId",
    });
  }

  const targetSessionId = sessionId.trim();
  const revoked = await revokeUserSession(
    userId,
    targetSessionId,
    "SESSION_REVOKED_BY_USER",
  );

  if (!revoked) {
    throw new AppError({
      statusCode: 404,
      code: "SESSION_NOT_FOUND",
      message: "Session not found",
    });
  }

  if (targetSessionId === currentSessionId) {
    clearAuthCookies(res);
  }

  return sendSuccess(res, {
    message: "Session revoked",
    data: {
      revokedSessionId: targetSessionId,
      currentSessionRevoked: targetSessionId === currentSessionId,
    },
  });
}
