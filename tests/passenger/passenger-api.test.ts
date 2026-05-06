import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "../../src/config/prisma.js";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/utils/password.js";

/**
 * Mock realtime / cache services
 */
vi.mock("../../src/services/tripRealtimeState.service.js", () => ({
  getTripRealtimeState: async () => null,
}));

vi.mock("../../src/services/tripStopsCache.service.js", () => ({
  getStopsForTrip: async () => ({
    stops: [],
  }),
}));

vi.mock("../../src/services/locationBuffer.service.js", () => ({
  getLocationHistory: async () => [],
}));

const app = createApp();

let passengerCookies: string[];
let driverCookies: string[];

let routeId: string;
let tripId: string;
let busId: string;

async function createPassengerAndLogin() {
  const email = `passenger_${Date.now()}@test.com`;

  await prisma.user.create({
    data: {
      fullName: "Passenger Test",
      email,
      passwordHash: await hashPassword("Password123!"),
      role: "PASSENGER",
      isActive: true,
    },
  });

  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!",
  });

  return res.headers["set-cookie"];
}

async function createDriverAndLogin() {
  const email = `driver_${Date.now()}@test.com`;

  const driver = await prisma.user.create({
    data: {
      fullName: "Driver Test",
      email,
      passwordHash: await hashPassword("Password123!"),
      role: "DRIVER",
      isActive: true,
    },
  });

  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!",
  });

  return {
    cookies: res.headers["set-cookie"],
    driverId: driver.id,
  };
}

beforeAll(async () => {
  const bus = await prisma.bus.create({
    data: {
      busCode: `BUS-${Date.now()}`,
      plateNumber: `TEST-${Date.now()}`,
      capacity: 40,
      isActive: true,
    },
  });

  const route = await prisma.route.create({
    data: {
      routeName: `Passenger Route ${Date.now()}`,
      isActive: true,
    },
  });

  busId = bus.id;
  routeId = route.id;

  passengerCookies = await createPassengerAndLogin();

  const driver = await createDriverAndLogin();
  driverCookies = driver.cookies;

  const trip = await prisma.trip.create({
    data: {
      busId,
      routeId,
      driverId: driver.driverId,
      status: "RUNNING",
      startTime: new Date(),
      activationMode: "MANUAL_DRIVER",
      startedByGpsDeviceId: null,
      isStale: false,
      lastTrackingSourceType: "DRIVER_MOBILE",
      lastTrackingSourceStatus: "HEALTHY",
      lastTrackingSelectionReason: "DRIVER_ONLY",
      lastTrackingSourceLabel: "Driver Mobile",
      lastTrackingSourceRecordedAt: new Date(),
    },
  });

  tripId = trip.id;
});

describe("Passenger API", () => {
  it("GET live buses by route", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/routes/${routeId}/live-buses`)
      .set("Cookie", passengerCookies);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET live trip state", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/trips/${tripId}/live`)
      .set("Cookie", passengerCookies);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET trip ETA", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/trips/${tripId}/eta`)
      .set("Cookie", passengerCookies);

    expect([200, 404]).toContain(res.status);
  });

  it("GET active trips list", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/trips/active`)
      .set("Cookie", passengerCookies);

    expect(res.status).toBe(200);
  });
});
