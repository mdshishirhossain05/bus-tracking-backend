import request from "supertest";
import { describe, it, expect } from "vitest";
import { makeTestApp } from "../helpers/app.js";
describe("Health endpoints", () => {
    const app = makeTestApp();
    it("GET /live should return alive response", async () => {
        const res = await request(app).get("/live");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe("Service is alive");
        expect(res.body.data.status).toBe("ok");
        expect(typeof res.body.data.uptimeSeconds).toBe("number");
        expect(typeof res.body.data.timestamp).toBe("string");
    });
    it("GET /health should return health response", async () => {
        const res = await request(app).get("/health");
        expect([200, 503]).toContain(res.status);
        expect(typeof res.body.success).toBe("boolean");
        expect(typeof res.body.message).toBe("string");
    });
    it("GET /ready should return readiness response", async () => {
        const res = await request(app).get("/ready");
        expect([200, 503]).toContain(res.status);
        expect(typeof res.body.success).toBe("boolean");
        expect(typeof res.body.message).toBe("string");
    });
});
//# sourceMappingURL=health.test.js.map