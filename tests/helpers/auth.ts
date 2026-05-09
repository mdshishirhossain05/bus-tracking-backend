import request from "supertest";
import type { Express } from "express";

type RegisterPayload = {
  fullName: string;
  email: string;
  password: string;
  studentId?: string;
  phoneNumber?: string;
};

export const registerPassengerForTest = async (
  app: Express,
  payload: RegisterPayload,
) => {
  return request(app)
    .post("/api/v1/auth/register")
    .send({
      fullName: payload.fullName,
      email: payload.email,
      password: payload.password,
      studentId: payload.studentId ?? `STU-${Date.now()}`,
      phoneNumber: payload.phoneNumber ?? "01700000000",
    });
};

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

  return loginForTest(app, payload.email, payload.password);
};
