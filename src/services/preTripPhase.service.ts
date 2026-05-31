import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { haversineMeters, toNumber } from "../utils/geo.js";
import { logger } from "../config/logger.js";
import {
  emitTripPreTripStateChanged,
  type TripPreTripPhase,
} from "../sockets/tripRealtime.js";

/**
 * Pre-trip phase logic.
 *
 * A trip in `PRE_TRIP` status is one that has been "opened" ahead of the
 * scheduled departure (typically 60 minutes before) so that the bus's
 * live location can be visible to passengers BEFORE the official trip
 * starts. The phase tells you what the bus is actually doing right now:
 *
 *   AT_DEPOT             — parked / stationary outside the origin geofence
 *   APPROACHING_ORIGIN   — moving (and not yet in the origin geofence)
 *   AT_ORIGIN            — within the origin geofence (boarding window)
 *
 * Once the bus dwells inside the origin geofence long enough, the trip
 * auto-promotes from PRE_TRIP to RUNNING.
 */

export const ORIGIN_GEOFENCE_METERS = Number(
  env.PRE_TRIP_ORIGIN_GEOFENCE_METERS ?? 120,
);

export const ORIGIN_DWELL_FOR_AUTO_START_MS = Number(
  env.PRE_TRIP_ORIGIN_DWELL_MS ?? 30_000,
);

/** Speed (km/h) above which we consider the bus "moving" toward the origin. */
export const MOVING_THRESHOLD_KMH = Number(
  env.PRE_TRIP_MOVING_THRESHOLD_KMH ?? 4,
);

export type DerivePreTripPhaseInput = {
  currentLat: number;
  currentLng: number;
  originLat: number;
  originLng: number;
  currentSpeedKmh: number | null;
  previousPhase: TripPreTripPhase | null;
  originArrivedAt: Date | null;
  now: Date;
};

export type DerivePreTripPhaseOutput = {
  phase: TripPreTripPhase;
  distanceToOriginMeters: number;
  originArrivedAt: Date | null;
  shouldStartTrip: boolean;
};

export function derivePreTripPhase(
  input: DerivePreTripPhaseInput,
): DerivePreTripPhaseOutput {
  const distance = haversineMeters(
    input.currentLat,
    input.currentLng,
    input.originLat,
    input.originLng,
  );

  const inOriginGeofence = distance <= ORIGIN_GEOFENCE_METERS;
  const speed = input.currentSpeedKmh ?? 0;
  const isMoving = speed > MOVING_THRESHOLD_KMH;

  if (inOriginGeofence) {
    const arrivedAt = input.originArrivedAt ?? input.now;
    const dwellMs = input.now.getTime() - arrivedAt.getTime();

    return {
      phase: "AT_ORIGIN",
      distanceToOriginMeters: distance,
      originArrivedAt: arrivedAt,
      shouldStartTrip: dwellMs >= ORIGIN_DWELL_FOR_AUTO_START_MS,
    };
  }

  // Once we've started approaching, don't bounce back to AT_DEPOT just
  // because the bus paused at a traffic light. Sticky transition.
  if (isMoving || input.previousPhase === "APPROACHING_ORIGIN") {
    return {
      phase: "APPROACHING_ORIGIN",
      distanceToOriginMeters: distance,
      originArrivedAt: null,
      shouldStartTrip: false,
    };
  }

  return {
    phase: "AT_DEPOT",
    distanceToOriginMeters: distance,
    originArrivedAt: null,
    shouldStartTrip: false,
  };
}

type RouteOriginStop = {
  lat: number;
  lng: number;
  stopName: string;
};

const originStopCache = new Map<
  string,
  { stop: RouteOriginStop; cachedAt: number }
>();
const ORIGIN_STOP_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getRouteOriginStop(
  routeId: string,
): Promise<RouteOriginStop | null> {
  const cached = originStopCache.get(routeId);
  const now = Date.now();
  if (cached && now - cached.cachedAt < ORIGIN_STOP_CACHE_TTL_MS) {
    return cached.stop;
  }

  const first = await prisma.routeStop.findFirst({
    where: { routeId },
    orderBy: { stopOrder: "asc" },
    select: { stop: { select: { lat: true, lng: true, stopName: true } } },
  });

  if (!first?.stop) return null;

  const stop: RouteOriginStop = {
    lat: toNumber(first.stop.lat),
    lng: toNumber(first.stop.lng),
    stopName: first.stop.stopName,
  };

  originStopCache.set(routeId, { stop, cachedAt: now });
  return stop;
}

/**
 * Apply a location update to a PRE_TRIP trip:
 * derive the new phase, persist it (if changed), emit a realtime event,
 * and signal back whether the caller should now promote the trip to RUNNING.
 */
export async function applyPreTripLocationUpdate(params: {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  previousPhase: TripPreTripPhase | null;
  originArrivedAt: Date | null;
  lat: number;
  lng: number;
  speedKmh: number | null;
  recordedAt: Date;
}): Promise<{
  newPhase: TripPreTripPhase;
  distanceToOriginMeters: number | null;
  shouldStartTrip: boolean;
}> {
  const origin = await getRouteOriginStop(params.routeId);

  if (!origin) {
    logger.warn(
      { tripId: params.tripId, routeId: params.routeId },
      "pre-trip location: route has no origin stop; defaulting to AT_DEPOT",
    );
    return {
      newPhase: params.previousPhase ?? "AT_DEPOT",
      distanceToOriginMeters: null,
      shouldStartTrip: false,
    };
  }

  const derived = derivePreTripPhase({
    currentLat: params.lat,
    currentLng: params.lng,
    originLat: origin.lat,
    originLng: origin.lng,
    currentSpeedKmh: params.speedKmh,
    previousPhase: params.previousPhase,
    originArrivedAt: params.originArrivedAt,
    now: params.recordedAt,
  });

  const phaseChanged = derived.phase !== params.previousPhase;
  const arrivedAtChanged =
    (derived.originArrivedAt?.getTime() ?? null) !==
    (params.originArrivedAt?.getTime() ?? null);

  if (phaseChanged || arrivedAtChanged) {
    await prisma.trip.update({
      where: { id: params.tripId },
      data: {
        preTripPhase: derived.phase,
        originArrivedAt: derived.originArrivedAt,
      },
    });
  }

  if (phaseChanged) {
    emitTripPreTripStateChanged({
      tripId: params.tripId,
      routeId: params.routeId,
      busId: params.busId,
      driverId: params.driverId,
      preTripPhase: derived.phase,
      distanceToOriginMeters: Math.round(derived.distanceToOriginMeters),
      originArrivedAt: derived.originArrivedAt?.toISOString() ?? null,
      lat: params.lat,
      lng: params.lng,
      recordedAt: params.recordedAt.toISOString(),
    });
  }

  return {
    newPhase: derived.phase,
    distanceToOriginMeters: Math.round(derived.distanceToOriginMeters),
    shouldStartTrip: derived.shouldStartTrip,
  };
}
