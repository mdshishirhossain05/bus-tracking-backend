import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "../helpers/app.js";
import { deleteUserByEmail } from "../helpers/db.js";
import { prisma } from "../../src/config/prisma.js";
import { hashPassword } from "../../src/utils/password.js";
import { hashSecret } from "../../src/utils/otp.js";

const app = makeTestApp();

const testUser = {
  fullName: "Reset Test User",
  email: "reset.test.user@example.com",
  password: "Password123!",
  newPassword: "NewPassw0rd!",
};

async function createActiveUser() {
  await prisma.user.create({
    data: {
      fullName: testUser.fullName,
      email: testUser.email,
      passwordHash: await hashPassword(testUser.password),
      role: "PASSENGER",
      isActive: true,
      approvalStatus: "APPROVED",
    },
  });
}

// Seeds a PASSWORD_RESET OTP row with a known plaintext code (the emailed
// code cannot be read back through the API).
async function seedResetOtp(otp: string) {
  await prisma.emailVerificationOtp.create({
    data: {
      email: testUser.email,
      purpose: "PASSWORD_RESET",
      otpHash: hashSecret(otp),
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      requestedAt: new Date(),
    },
  });
}

describe("Forgot / reset password", () => {
  beforeEach(async () => {
    await deleteUserByEmail(testUser.email);
    await createActiveUser();
  });

  afterAll(async () => {
    await deleteUserByEmail(testUser.email);
  });

  it("request returns a generic success for an existing email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/forgot-password/request")
      .send({ email: testUser.email });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("If an account exists");
  });

  it("request returns an identical response for a non-existent email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/forgot-password/request")
      .send({ email: "definitely.not.a.user@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("If an account exists");
  });

  it("verify rejects an incorrect OTP", async () => {
    await seedResetOtp("123456");

    const res = await request(app)
      .post("/api/v1/auth/forgot-password/verify")
      .send({ email: testUser.email, otp: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("INVALID_OTP");
  });

  it("verify accepts a correct OTP and issues a verification token", async () => {
    await seedResetOtp("123456");

    const res = await request(app)
      .post("/api/v1/auth/forgot-password/verify")
      .send({ email: testUser.email, otp: "123456" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.verificationToken).toBe("string");
    expect(res.body.data.verificationToken.length).toBeGreaterThanOrEqual(32);
  });

  it("completes a full reset and allows login with the new password", async () => {
    await seedResetOtp("123456");

    const verifyRes = await request(app)
      .post("/api/v1/auth/forgot-password/verify")
      .send({ email: testUser.email, otp: "123456" });

    expect(verifyRes.status).toBe(200);
    const verificationToken = verifyRes.body.data.verificationToken as string;

    const resetRes = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({
        email: testUser.email,
        verificationToken,
        newPassword: testUser.newPassword,
        confirmPassword: testUser.newPassword,
      });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    const oldLogin = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: testUser.password,
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: testUser.newPassword,
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.success).toBe(true);
  });

  it("reset rejects an invalid verification token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({
        email: testUser.email,
        verificationToken: "x".repeat(64),
        newPassword: testUser.newPassword,
        confirmPassword: testUser.newPassword,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("RESET_TOKEN_INVALID");
  });

  it("reset rejects a mismatched password confirmation", async () => {
    await seedResetOtp("123456");

    const verifyRes = await request(app)
      .post("/api/v1/auth/forgot-password/verify")
      .send({ email: testUser.email, otp: "123456" });

    const verificationToken = verifyRes.body.data.verificationToken as string;

    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({
        email: testUser.email,
        verificationToken,
        newPassword: testUser.newPassword,
        confirmPassword: "DifferentPassw0rd!",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
