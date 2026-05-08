import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "../helpers/app.js";
import { deleteUserByEmail } from "../helpers/db.js";
import { registerAndLogin } from "../helpers/auth.js";

const app = makeTestApp();

const testUser = {
  fullName: "Session Test User",
  email: "session.test.user@example.com",
  password: "Password123!",
  studentId: "TP-SESSION-001",
};

describe("Auth session flow", () => {
  beforeEach(async () => {
    await deleteUserByEmail(testUser.email);
  });

  afterAll(async () => {
    await deleteUserByEmail(testUser.email);
  });

  it("POST /api/v1/auth/refresh should rotate tokens successfully", async () => {
    const loginRes = await registerAndLogin(app, testUser);

    const cookies = loginRes.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(Array.isArray(cookies)).toBe(true);

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookies);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.message).toBe("Token refreshed successfully");

    const refreshedCookies = refreshRes.headers["set-cookie"];
    expect(refreshedCookies).toBeDefined();
    expect(Array.isArray(refreshedCookies)).toBe(true);

    const cookieText = refreshedCookies.join(";");
    expect(cookieText).toContain("access_token=");
    expect(cookieText).toContain("refresh_token=");
  });

  it("GET /api/v1/auth/me should return current user when authenticated", async () => {
    const loginRes = await registerAndLogin(app, testUser);

    const cookies = loginRes.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(Array.isArray(cookies)).toBe(true);

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookies);

    expect(meRes.status).toBe(200);
    expect(meRes.body.success).toBe(true);
    expect(meRes.body.message).toBe("Current user fetched successfully");
    expect(meRes.body.data.user.email).toBe(testUser.email);
    expect(meRes.body.data.user.role).toBe("PASSENGER");
  });

  it("GET /api/v1/auth/sessions should list active sessions", async () => {
    const loginRes = await registerAndLogin(app, testUser);

    const cookies = loginRes.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(Array.isArray(cookies)).toBe(true);

    const sessionsRes = await request(app)
      .get("/api/v1/auth/sessions")
      .set("Cookie", cookies);

    expect(sessionsRes.status).toBe(200);
    expect(sessionsRes.body.success).toBe(true);
    expect(sessionsRes.body.message).toBe("Sessions fetched successfully");
    expect(Array.isArray(sessionsRes.body.data.sessions)).toBe(true);
    expect(sessionsRes.body.data.sessions.length).toBeGreaterThan(0);

    const firstSession = sessionsRes.body.data.sessions[0];
    expect(typeof firstSession.id).toBe("string");
    expect(typeof firstSession.current).toBe("boolean");
  });

  it("POST /api/v1/auth/logout should revoke current session", async () => {
    const loginRes = await registerAndLogin(app, testUser);

    const cookies = loginRes.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(Array.isArray(cookies)).toBe(true);

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookies);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);
    expect(logoutRes.body.message).toBe("Logged out successfully");
  });

  it("POST /api/v1/auth/logout-all should revoke all sessions", async () => {
    const loginRes = await registerAndLogin(app, testUser);

    const cookies = loginRes.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(Array.isArray(cookies)).toBe(true);

    const logoutAllRes = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Cookie", cookies);

    expect(logoutAllRes.status).toBe(200);
    expect(logoutAllRes.body.success).toBe(true);
    expect(logoutAllRes.body.message).toBe("Logged out from all devices");
  });

  it("POST /api/v1/auth/logout-others should keep current session alive", async () => {
    const loginRes1 = await registerAndLogin(app, testUser);

    const cookies1 = loginRes1.headers["set-cookie"];
    expect(cookies1).toBeDefined();
    expect(Array.isArray(cookies1)).toBe(true);

    const loginRes2 = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: testUser.password,
    });

    const cookies2 = loginRes2.headers["set-cookie"];
    expect(cookies2).toBeDefined();
    expect(Array.isArray(cookies2)).toBe(true);

    const logoutOthersRes = await request(app)
      .post("/api/v1/auth/logout-others")
      .set("Cookie", cookies1);

    expect(logoutOthersRes.status).toBe(200);
    expect(logoutOthersRes.body.success).toBe(true);
    expect(logoutOthersRes.body.message).toBe("Logged out from other devices");

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookies1);

    expect(meRes.status).toBe(200);
    expect(meRes.body.success).toBe(true);

    const meResOther = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookies2);

    expect(meResOther.status).toBe(401);
    expect(meResOther.body.success).toBe(false);
    expect(["SESSION_REVOKED", "INVALID_OR_EXPIRED_TOKEN"]).toContain(
      meResOther.body.code,
    );
  });

  it("DELETE /api/v1/auth/sessions/:sessionId should revoke one session", async () => {
    const loginRes1 = await registerAndLogin(app, testUser);

    const cookies1 = loginRes1.headers["set-cookie"];
    expect(cookies1).toBeDefined();
    expect(Array.isArray(cookies1)).toBe(true);

    const loginRes2 = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: testUser.password,
    });

    const cookies2 = loginRes2.headers["set-cookie"];
    expect(cookies2).toBeDefined();
    expect(Array.isArray(cookies2)).toBe(true);

    const sessionsRes = await request(app)
      .get("/api/v1/auth/sessions")
      .set("Cookie", cookies1);

    expect(sessionsRes.status).toBe(200);
    expect(sessionsRes.body.success).toBe(true);

    const sessions = sessionsRes.body.data.sessions as Array<{
      id: string;
      current: boolean;
    }>;

    const otherSession = sessions.find((s) => s.current === false);
    expect(otherSession).toBeDefined();

    const revokeRes = await request(app)
      .delete(`/api/v1/auth/sessions/${otherSession!.id}`)
      .set("Cookie", cookies1);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);
    expect(revokeRes.body.message).toBe("Session revoked");

    const meResOther = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookies2);

    expect(meResOther.status).toBe(401);
    expect(meResOther.body.success).toBe(false);
    expect(["SESSION_REVOKED", "INVALID_OR_EXPIRED_TOKEN"]).toContain(
      meResOther.body.code,
    );
  });
});
