import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
/**
 * Mock runtime infrastructure that is not initialized when using createApp()
 * in tests (Socket.IO, Redis-backed services, distributed locks, etc.)
 */
vi.mock("../../src/sockets/io.js", () => {
  return {
    getIO: () => ({
      to: () => ({
        emit: () => undefined,
      }),
    }),
    setIO: () => undefined,
  };
});
vi.mock("../../src/services/tripLock.service.js", () => {
  return {
    acquireTripStartLock: async () => ({
      ok: true,
      lock: "test-lock",
      reason: null,
    }),
    releaseTripStartLock: async () => undefined,
  };
});
vi.mock("../../src/services/idempotency.service.js", () => {
  return {
    beginIdempotentRequest: async () => ({
      type: "START",
    }),
    buildFingerprint: (input) => JSON.stringify(input),
    completeIdempotentRequest: async () => undefined,
    failIdempotentRequest: async () => undefined,
  };
});
vi.mock("../../src/services/locationRateLimiter.js", () => {
  return {
    canSendLocation: async () => ({
      allowed: true,
      reason: null,
    }),
    isMonotonic: async () => ({
      allowed: true,
      reason: null,
    }),
  };
});
vi.mock("../../src/services/tripRealtimeState.service.js", () => {
  return {
    setTripRealtimeState: async () => undefined,
    clearTripRealtimeState: async () => undefined,
  };
});
vi.mock("../../src/services/tripStopsCache.service.js", () => {
  return {
    getStopsForTrip: async (tripId) => ({
      routeId: tripId,
      stops: [],
    }),
  };
});
vi.mock("../../src/services/locationBuffer.service.js", () => {
  return {
    maybePersistLocation: async () => ({
      persisted: false,
    }),
  };
});
import { prisma } from "../../src/config/prisma.js";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/utils/password.js";
const app = createApp();
let driverCookies;
let passengerCookies;
let driverUserId;
let passengerUserId;
let busId;
let routeId;
let tripId;
const uniqueSuffix = Date.now();
async function createDriverAndLogin() {
  const email = `driver_${uniqueSuffix}@test.com`;
  const driver = await prisma.user.create({
    data: {
      fullName: "Test Driver",
      email,
      passwordHash: await hashPassword("Password123!"),
      role: "DRIVER",
      isActive: true,
    },
  });
  driverUserId = driver.id;
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!",
  });
  return res.headers["set-cookie"];
}
async function createPassengerAndLogin() {
  const email = `passenger_${uniqueSuffix}@test.com`;
  const passenger = await prisma.user.create({
    data: {
      fullName: "Test Passenger",
      email,
      passwordHash: await hashPassword("Password123!"),
      role: "PASSENGER",
      isActive: true,
    },
  });
  passengerUserId = passenger.id;
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!",
  });
  return res.headers["set-cookie"];
}
beforeAll(async () => {
  const bus = await prisma.bus.create({
    data: {
      busCode: `BUS-${uniqueSuffix}`,
      plateNumber: `TEST-${uniqueSuffix}`,
      capacity: 40,
      isActive: true,
    },
  });
  const route = await prisma.route.create({
    data: {
      routeName: `Test Route ${uniqueSuffix}`,
      isActive: true,
    },
  });
  busId = bus.id;
  routeId = route.id;
  driverCookies = await createDriverAndLogin();
  passengerCookies = await createPassengerAndLogin();
});
afterAll(async () => {
  // Delete trips first because of FK dependencies
  await prisma.trip.deleteMany({
    where: {
      OR: [{ busId }, { routeId }, { driverId: driverUserId }],
    },
  });
  await prisma.bus.deleteMany({
    where: { id: busId },
  });
  await prisma.route.deleteMany({
    where: { id: routeId },
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [driverUserId, passengerUserId].filter(Boolean),
      },
    },
  });
});
describe("Driver Trip Lifecycle", () => {
  it("DRIVER should start a trip successfully", async () => {
    const res = await request(app)
      .post("/api/v1/driver/trips/start")
      .set("Cookie", driverCookies)
      .set("Idempotency-Key", `start-${Date.now()}`)
      .send({
        busId,
        routeId,
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Trip started successfully");
    expect(res.body.data.trip.busId).toBe(busId);
    expect(res.body.data.trip.routeId).toBe(routeId);
    expect(res.body.data.trip.status).toBe("RUNNING");
    tripId = res.body.data.trip.id;
    expect(typeof tripId).toBe("string");
  });
  it("PASSENGER cannot start trip", async () => {
    const res = await request(app)
      .post("/api/v1/driver/trips/start")
      .set("Cookie", passengerCookies)
      .set("Idempotency-Key", `start-passenger-${Date.now()}`)
      .send({
        busId,
        routeId,
      });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("FORBIDDEN");
  });
  it("startTrip should require Idempotency-Key", async () => {
    const res = await request(app)
      .post("/api/v1/driver/trips/start")
      .set("Cookie", driverCookies)
      .send({
        busId,
        routeId,
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
  it("DRIVER should send location update", async () => {
    const res = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/location`)
      .set("Cookie", driverCookies)
      .send({
        lat: 23.7806,
        lng: 90.4071,
        speedKmh: 30,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Location accepted");
  });
  it("location update should reject invalid tripId", async () => {
    const res = await request(app)
      .post("/api/v1/driver/trips/invalid/location")
      .set("Cookie", driverCookies)
      .send({
        lat: 23.7806,
        lng: 90.4071,
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("INVALID_TRIP_ID");
  });
  it("PASSENGER cannot send location", async () => {
    const res = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/location`)
      .set("Cookie", passengerCookies)
      .send({
        lat: 23.7806,
        lng: 90.4071,
      });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("FORBIDDEN");
  });
  it("DRIVER should end trip", async () => {
    const res = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/end`)
      .set("Cookie", driverCookies)
      .set("Idempotency-Key", `end-${Date.now()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Trip ended successfully");
    expect(res.body.data.trip.status).toBe("ENDED");
  });
  it("ending trip again should return already ended", async () => {
    const res = await request(app)
      .post(`/api/v1/driver/trips/${tripId}/end`)
      .set("Cookie", driverCookies)
      .set("Idempotency-Key", `end-again-${Date.now()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("already ended");
  });
});
//# sourceMappingURL=driver-trip.test.js.map
