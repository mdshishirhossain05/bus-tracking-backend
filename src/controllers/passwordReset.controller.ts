import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import {
  forgotPasswordRequestSchema,
  forgotPasswordVerifySchema,
  resetPasswordSchema,
} from "../validators/auth.validators.js";
import { hashPassword } from "../utils/password.js";
import { clearAuthCookies } from "../utils/cookies.js";
import {
  hashSecret,
  generateOtp,
  generateVerificationToken,
  safeHashCompare,
} from "../utils/otp.js";
import { revokeAllUserSessions } from "../services/auth.service.js";
import { writeAuditLogSafe, getRequestIp } from "../services/audit.service.js";
import { sendPasswordResetOtpEmail } from "../services/email.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";

const PASSWORD_RESET_OTP_PURPOSE = "PASSWORD_RESET";

function assertFeatureEnabled() {
  if (!env.FORGOT_PASSWORD_ENABLED) {
    throw new AppError({
      statusCode: 403,
      code: "FORGOT_PASSWORD_DISABLED",
      message: "Password reset is currently unavailable. Please contact support.",
    });
  }
}

// Small random delay so the response timing for non-existent emails is
// indistinguishable from the work done for existing accounts.
async function antiEnumerationDelay() {
  const delayMs = 120 + Math.floor(Math.random() * 280);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * POST /auth/forgot-password/request
 * Always returns a generic 200 regardless of whether the email exists, to
 * prevent account enumeration.
 */
export async function requestPasswordReset(req: Request, res: Response) {
  assertFeatureEnabled();

  const parsed = forgotPasswordRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid email address",
      details: parsed.error.format(),
    });
  }

  const email = parsed.data.email;

  const genericResponse = () =>
    sendSuccess(res, {
      message:
        "If an account exists for this email, a password reset code has been sent.",
      data: {
        email,
        resendAfterSeconds: env.PASSWORD_RESET_OTP_RESEND_COOLDOWN_SECONDS,
      },
    });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });

  if (!user) {
    await antiEnumerationDelay();
    return genericResponse();
  }

  const now = new Date();

  // Resend cooldown — silently skip sending (still a generic 200) so the
  // response shape never reveals account existence or request cadence.
  const latestOtp = await prisma.emailVerificationOtp.findFirst({
    where: {
      email,
      purpose: PASSWORD_RESET_OTP_PURPOSE,
      consumedAt: null,
    },
    orderBy: { requestedAt: "desc" },
    select: { requestedAt: true },
  });

  if (latestOtp) {
    const elapsedSeconds = Math.floor(
      (now.getTime() - latestOtp.requestedAt.getTime()) / 1000,
    );

    if (
      env.PASSWORD_RESET_OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds >
      0
    ) {
      return genericResponse();
    }
  }

  const otp = generateOtp();
  const expiresAt = new Date(
    now.getTime() + env.PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000,
  );

  await prisma.emailVerificationOtp.create({
    data: {
      email,
      purpose: PASSWORD_RESET_OTP_PURPOSE,
      otpHash: hashSecret(otp),
      maxAttempts: env.PASSWORD_RESET_OTP_MAX_ATTEMPTS,
      expiresAt,
      requestedAt: now,
    },
  });

  // A delivery failure must not turn the generic 200 into a 500 (which would
  // only happen for existing accounts and thus leak enumeration).
  try {
    await sendPasswordResetOtpEmail({
      to: email,
      otp,
      expiresInMinutes: env.PASSWORD_RESET_OTP_TTL_MINUTES,
    });
  } catch (err) {
    req.log?.error(
      { err, requestId: req.requestId ?? null },
      "sendPasswordResetOtpEmail failed",
    );
  }

  await writeAuditLogSafe({
    actorUserId: user.id,
    actorRole: user.role,
    action: "PASSWORD_RESET_OTP_REQUESTED",
    entityType: "EmailVerificationOtp",
    entityId: null,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    metaJson: {
      email,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return genericResponse();
}

/**
 * POST /auth/forgot-password/verify
 * Validates the OTP and issues a single-use verification token.
 */
export async function verifyPasswordResetOtp(req: Request, res: Response) {
  assertFeatureEnabled();

  const parsed = forgotPasswordVerifySchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid OTP data",
      details: parsed.error.format(),
    });
  }

  const { email, otp } = parsed.data;
  const now = new Date();

  const record = await prisma.emailVerificationOtp.findFirst({
    where: {
      email,
      purpose: PASSWORD_RESET_OTP_PURPOSE,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { requestedAt: "desc" },
  });

  if (!record) {
    throw new AppError({
      statusCode: 400,
      code: "OTP_NOT_FOUND_OR_EXPIRED",
      message: "Verification code is invalid or expired.",
    });
  }

  if (record.attempts >= record.maxAttempts) {
    throw new AppError({
      statusCode: 429,
      code: "OTP_MAX_ATTEMPTS_EXCEEDED",
      message: "Too many incorrect OTP attempts. Please request a new code.",
    });
  }

  const isValidOtp = safeHashCompare(hashSecret(otp), record.otpHash);

  if (!isValidOtp) {
    const updated = await prisma.emailVerificationOtp.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true, maxAttempts: true },
    });

    const remainingAttempts = Math.max(
      0,
      updated.maxAttempts - updated.attempts,
    );

    throw new AppError({
      statusCode: 400,
      code: "INVALID_OTP",
      message: `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`,
    });
  }

  const verificationToken = generateVerificationToken();

  await prisma.emailVerificationOtp.update({
    where: { id: record.id },
    data: {
      verifiedAt: now,
      verificationTokenHash: hashSecret(verificationToken),
    },
  });

  await writeAuditLogSafe({
    actorUserId: null,
    actorRole: null,
    action: "PASSWORD_RESET_EMAIL_VERIFIED",
    entityType: "EmailVerificationOtp",
    entityId: record.id,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    metaJson: { email },
  });

  return sendSuccess(res, {
    message: "Verification successful.",
    data: {
      email,
      verificationToken,
    },
  });
}

/**
 * POST /auth/reset-password
 * Consumes the verification token, updates the password, revokes all
 * sessions and clears auth cookies — forcing a fresh login.
 */
export async function resetPassword(req: Request, res: Response) {
  assertFeatureEnabled();

  const parsed = resetPasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid data",
      details: parsed.error.format(),
    });
  }

  const { email, verificationToken, newPassword } = parsed.data;
  const now = new Date();

  const record = await prisma.emailVerificationOtp.findFirst({
    where: {
      email,
      purpose: PASSWORD_RESET_OTP_PURPOSE,
      verificationTokenHash: hashSecret(verificationToken),
      verifiedAt: { not: null },
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { verifiedAt: "desc" },
    select: { id: true },
  });

  if (!record) {
    throw new AppError({
      statusCode: 400,
      code: "RESET_TOKEN_INVALID",
      message:
        "This password reset request is invalid or has expired. Please start again.",
    });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });

  if (!user) {
    throw new AppError({
      statusCode: 400,
      code: "RESET_TOKEN_INVALID",
      message:
        "This password reset request is invalid or has expired. Please start again.",
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await tx.emailVerificationOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
  });

  await revokeAllUserSessions(user.id, "PASSWORD_RESET");

  clearAuthCookies(res);

  await writeAuditLogSafe({
    actorUserId: user.id,
    actorRole: user.role,
    action: "PASSWORD_RESET_COMPLETED",
    entityType: "User",
    entityId: user.id,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    metaJson: { email },
  });

  return sendSuccess(res, {
    message: "Password reset successfully. Please log in with your new password.",
  });
}
