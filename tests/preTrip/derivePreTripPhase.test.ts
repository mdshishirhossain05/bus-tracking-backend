import { describe, test, expect } from "vitest";
import {
  derivePreTripPhase,
  ORIGIN_DWELL_FOR_AUTO_START_MS,
} from "../../src/services/preTripPhase.service.js";

const ORIGIN = { lat: 23.7806, lng: 90.2792 };
const AT_ORIGIN_POINT = { lat: 23.78062, lng: 90.27922 };
// ~220m north of origin — just outside the 120m default geofence
const NEAR_BUT_OUTSIDE_ORIGIN = { lat: 23.7826, lng: 90.2792 };
const FAR_POINT = { lat: 23.79, lng: 90.32 };

describe("derivePreTripPhase", () => {
  test("inside origin geofence with no previous arrival sets AT_ORIGIN and arrivedAt", () => {
    const now = new Date("2026-05-31T10:00:00Z");

    const out = derivePreTripPhase({
      currentLat: AT_ORIGIN_POINT.lat,
      currentLng: AT_ORIGIN_POINT.lng,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      currentSpeedKmh: 0,
      previousPhase: "APPROACHING_ORIGIN",
      originArrivedAt: null,
      now,
    });

    expect(out.phase).toBe("AT_ORIGIN");
    expect(out.originArrivedAt).toEqual(now);
    expect(out.shouldStartTrip).toBe(false);
  });

  test("dwell at origin past threshold triggers shouldStartTrip", () => {
    const arrivedAt = new Date("2026-05-31T10:00:00Z");
    const now = new Date(arrivedAt.getTime() + ORIGIN_DWELL_FOR_AUTO_START_MS);

    const out = derivePreTripPhase({
      currentLat: AT_ORIGIN_POINT.lat,
      currentLng: AT_ORIGIN_POINT.lng,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      currentSpeedKmh: 0,
      previousPhase: "AT_ORIGIN",
      originArrivedAt: arrivedAt,
      now,
    });

    expect(out.phase).toBe("AT_ORIGIN");
    expect(out.shouldStartTrip).toBe(true);
  });

  test("moving outside geofence flips to APPROACHING_ORIGIN", () => {
    const out = derivePreTripPhase({
      currentLat: FAR_POINT.lat,
      currentLng: FAR_POINT.lng,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      currentSpeedKmh: 25,
      previousPhase: "AT_DEPOT",
      originArrivedAt: null,
      now: new Date(),
    });

    expect(out.phase).toBe("APPROACHING_ORIGIN");
    expect(out.originArrivedAt).toBeNull();
    expect(out.shouldStartTrip).toBe(false);
  });

  test("stationary outside geofence with no prior approach stays AT_DEPOT", () => {
    const out = derivePreTripPhase({
      currentLat: FAR_POINT.lat,
      currentLng: FAR_POINT.lng,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      currentSpeedKmh: 0,
      previousPhase: null,
      originArrivedAt: null,
      now: new Date(),
    });

    expect(out.phase).toBe("AT_DEPOT");
  });

  test("brief stop outside geofence does NOT regress from APPROACHING_ORIGIN to AT_DEPOT", () => {
    // Sticky transition: stopped at a red light while approaching shouldn't
    // make the passenger UI flip back to "parked at depot".
    const out = derivePreTripPhase({
      currentLat: NEAR_BUT_OUTSIDE_ORIGIN.lat,
      currentLng: NEAR_BUT_OUTSIDE_ORIGIN.lng,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      currentSpeedKmh: 0,
      previousPhase: "APPROACHING_ORIGIN",
      originArrivedAt: null,
      now: new Date(),
    });

    expect(out.phase).toBe("APPROACHING_ORIGIN");
  });

  test("arrival at origin shortly after dwell does not yet auto-start", () => {
    const arrivedAt = new Date("2026-05-31T10:00:00Z");
    const now = new Date(arrivedAt.getTime() + 10_000); // only 10s of dwell

    const out = derivePreTripPhase({
      currentLat: AT_ORIGIN_POINT.lat,
      currentLng: AT_ORIGIN_POINT.lng,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      currentSpeedKmh: 0,
      previousPhase: "AT_ORIGIN",
      originArrivedAt: arrivedAt,
      now,
    });

    expect(out.phase).toBe("AT_ORIGIN");
    expect(out.shouldStartTrip).toBe(false);
    expect(out.originArrivedAt).toEqual(arrivedAt);
  });

  test("re-entering the geofence after leaving resets arrivedAt", () => {
    const out = derivePreTripPhase({
      currentLat: AT_ORIGIN_POINT.lat,
      currentLng: AT_ORIGIN_POINT.lng,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      currentSpeedKmh: 0,
      previousPhase: "APPROACHING_ORIGIN",
      originArrivedAt: null,
      now: new Date("2026-05-31T11:00:00Z"),
    });

    expect(out.phase).toBe("AT_ORIGIN");
    expect(out.originArrivedAt).toEqual(new Date("2026-05-31T11:00:00Z"));
  });
});
