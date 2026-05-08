import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "../helpers/app.js";
import { deleteUserByEmail } from "../helpers/db.js";
import {
  buildVerifiedPassengerRegistrationPayload,
  registerPassengerForTest,
} from "../helpers/auth.js";

const app = makeTestApp();

const testUser = {
  fullName: "Test Passenger",
  email: "test.passenger@example.com",
  password: "Password123!",
  studentId: "TP-TEST-001",
};

describe("Auth register + login", () => {
  beforeEach(async () => {
    await deleteUserByEmail(testUser.email);
  });

  afterAll(async () => {
    await deleteUserByEmail(testUser.email);
  });

  it("POST /api/v1/auth/register should create a new passenger", async () => {
    const res = await registerPassengerForTest(app, testUser);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Passenger registered successfully");

    expect(res.body.data.user).toMatchObject({
      fullName: testUser.fullName,
      email: testUser.email,
      role: "PASSENGER",
    });

    expect(typeof res.body.data.user.id).toBe("string");
  });

  it("POST /api/v1/auth/register should reject duplicate email", async () => {
    await registerPassengerForTest(app, testUser);

    const duplicatePayload =
      await buildVerifiedPassengerRegistrationPayload(testUser);

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(duplicatePayload);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("EMAIL_ALREADY_EXISTS");
    expect(res.body.message).toBe("Email already exists");
  });

  it("POST /api/v1/auth/login should login successfully and set cookies", async () => {
    await registerPassengerForTest(app, testUser);

    const res = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: testUser.password,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Login successful");

    expect(res.body.data.user).toMatchObject({
      fullName: testUser.fullName,
      email: testUser.email,
      role: "PASSENGER",
    });

    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(Array.isArray(setCookie)).toBe(true);

    const cookieText = setCookie.join(";");
    expect(cookieText).toContain("access_token=");
    expect(cookieText).toContain("refresh_token=");
  });

  it("POST /api/v1/auth/login should reject wrong password", async () => {
    await registerPassengerForTest(app, testUser);

    const res = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: "WrongPassword123!",
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
    expect(res.body.message).toBe("Invalid credentials");
  });

  it("POST /api/v1/auth/login should reject unknown email", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "unknown.user@example.com",
      password: "Password123!",
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
    expect(res.body.message).toBe("Invalid credentials");
  });

  it("POST /api/v1/auth/register should reject invalid payload", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      fullName: "",
      email: "not-an-email",
      password: "123",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.message).toBe("Invalid data");
  });
});
