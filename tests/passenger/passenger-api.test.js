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
let passengerCookies;
let driverCookies;
let routeId;
let tripId;
let busId;
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
    },
  });
  tripId = trip.id;
});
describe("Passenger API", () => {
  it("GET active trip by route", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/routes/${routeId}/active-trip`)
      .set("Cookie", passengerCookies);
    expect([200, 404]).toContain(res.status);
  });
  it("GET last location", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/trips/${tripId}/last-location`)
      .set("Cookie", passengerCookies);
    expect([200, 404]).toContain(res.status);
  });
  it("GET trip details", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/trips/${tripId}/details`)
      .set("Cookie", passengerCookies);
    expect(res.status).toBe(200);
  });
  it("GET location history", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/trips/${tripId}/history`)
      .set("Cookie", passengerCookies);
    expect(res.status).toBe(200);
  });
  it("GET ETA", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/trips/${tripId}/eta`)
      .set("Cookie", passengerCookies);
    expect([200, 404]).toContain(res.status);
  });
  it("GET arrivals", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/trips/${tripId}/arrivals`)
      .set("Cookie", passengerCookies);
    expect(res.status).toBe(200);
  });
  it("GET trip dashboard", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/trips/${tripId}/dashboard`)
      .set("Cookie", passengerCookies);
    expect(res.status).toBe(200);
  });
  it("GET route dashboard", async () => {
    const res = await request(app)
      .get(`/api/v1/passenger/routes/${routeId}/dashboard`)
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
//# sourceMappingURL=passenger-api.test.js.map
