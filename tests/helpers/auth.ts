import request from "supertest";
import type { Express } from "express";

export async function registerAndLogin(
  app: Express,
  user: {
    fullName: string;
    email: string;
    password: string;
  },
) {
  await request(app).post("/api/v1/auth/register").send(user);

  const loginRes = await request(app).post("/api/v1/auth/login").send({
    email: user.email,
    password: user.password,
  });

  return loginRes;
}
