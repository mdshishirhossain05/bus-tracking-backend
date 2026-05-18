import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { prisma } from "../../src/config/prisma.js";
import { env } from "../../src/config/env.js";
import { enablePassengerSelfRegistrationForTests } from "./db.js";

type RegisterPayload = {
  fullName: string;
  email: string;
  password: string;
  studentId?: string;
  phoneNumber?: string;
};

const PASSENGER_REGISTRATION_OTP_PURPOSE = "PASSENGER_REGISTRATION";

// Mirrors the controller-private hashSecret() so tests can seed verified
// OTP rows without depending on the (unreadable) emailed plaintext OTP.
function hashSecret(value: string) {
  return createHash("sha256")
    .update(`${value}:${env.JWT_ACCESS_SECRET}`, "utf8")
    .digest("hex");
}

/**
 * Seeds a pre-verified EmailVerificationOtp row and returns a passenger
 * registration payload carrying the matching emailVerificationToken.
 * This exercises the real /register endpoint while bypassing only the
 * email delivery channel (which cannot be tested without SMTP).
 */
export async function buildVerifiedPassengerRegistrationPayload(
  payload: RegisterPayload,
) {
  await enablePassengerSelfRegistrationForTests();

  const email = payload.email.trim().toLowerCase();
  const emailVerificationToken = randomBytes(32).toString("hex");

  await prisma.emailVerificationOtp.create({
    data: {
      email,
      purpose: PASSENGER_REGISTRATION_OTP_PURPOSE,
      otpHash: hashSecret("000000"),
      verificationTokenHash: hashSecret(emailVerificationToken),
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    fullName: payload.fullName,
    email: payload.email,
    password: payload.password,
    studentId: payload.studentId ?? `STU-${Date.now()}`,
    phoneNumber: payload.phoneNumber ?? "01700000000",
    emailVerificationToken,
  };
}

export const registerPassengerForTest = async (
  app: Express,
  payload: RegisterPayload,
) => {
  const body = await buildVerifiedPassengerRegistrationPayload(payload);

  return request(app).post("/api/v1/auth/register").send(body);
};

/**
 * Self-registered passengers are created PENDING_APPROVAL + inactive and
 * cannot log in until an admin approves them. Tests that need a usable
 * login call this to approve + activate the account.
 */
export async function approveAndActivatePassenger(email: string) {
  await prisma.user.updateMany({
    where: { email: email.trim().toLowerCase() },
    data: {
      approvalStatus: "APPROVED",
      isActive: true,
    },
  });
}

export const loginForTest = async (
  app: Express,
  email: string,
  password: string,
) => {
  return request(app).post("/api/v1/auth/login").send({
    email,
    password,
  });
};

export const registerAndLogin = async (
  app: Express,
  payload: RegisterPayload,
) => {
  await registerPassengerForTest(app, payload);
  await approveAndActivatePassenger(payload.email);

  return loginForTest(app, payload.email, payload.password);
};
