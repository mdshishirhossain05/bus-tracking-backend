import { prisma } from "../config/prisma.js";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";
import { writeAuditLogSafe } from "./audit.service.js";
import {
  clearTripLastGoodRealtimeState,
  clearTripRealtimeState,
  clearTripSourceRealtimeState,
} from "./tripRealtimeState.service.js";
import { emitTripEnded } from "../sockets/tripRealtime.js";
import { logTripEnded, logSystemAlert } from "./tripEvent.service.js";
import { getStopsForTrip } from "./tripStopsCache.service.js";
import { getLatestArrivedStopForTrip } from "./stopArrivalProgress.service.js";
import { computeNextStopAndEta } from "./eta.service.js";
import { haversineMeters } from "../utils/geo.js";

export type TripEndReason =
  | "MANUAL_DRIVER"
  | "MANUAL_ADMIN"
  | "AUTO_FINAL_STOP_ARRIVAL"
  | "AUTO_FINAL_STOP_STATIONARY"
  | "AUTO_TELEMETRY_TIMEOUT"
  | "SYSTEM_STALE_TIMEOUT";

export type TripEndMode =
  | "MANUAL_DRIVER"
  | "AUTO_TELEMATICS"
  | "MANUAL_ADMIN"
  | "SYSTEM";

type FinalizeTripInput = {
  tripId: string;
  endedAt?: Date;
  endMode: TripEndMode;
  endReason: TripEndReason;
  endedBySourceType?: "DRIVER_MOBILE" | "GPS_DEVICE" | "SYSTEM" | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  route?: string | null;
  method?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metaJson?: unknown;
};

type FinalizeTripResult = {
  finalized: boolean;
  alreadyEnded: boolean;
  trip: {
    id: string;
    routeId: string;
    busId: string;
    driverId: string;
    status: "ENDED";
    endTime: Date | null;
  };
};

type MaybeAutoEndInput = {
  tripId: string;
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
  sourceStatus: "HEALTHY" | "STALE" | "UNHEALTHY" | "DISCONNECTED";
  currentLat: number;
  currentLng: number;
  currentSpeedKmh: number | null;
  isStationary: boolean;
  recordedAt: Date;
};

type MaybeAutoEndResult = {
  ended: boolean;
  reason:
    | "DISABLED"
    | "TRIP_NOT_FOUND"
    | "TRIP_NOT_RUNNING"
    | "SOURCE_NOT_ELIGIBLE"
    | "NO_ROUTE_STOPS"
    | "PENDING_FINAL_STOP_STATIONARY"
    | "NO_AUTO_END_CONDITION"
    | TripEndReason;
  tripId: string | null;
};

function stationaryCandidateKey(tripId: string) {
  return `tripAutoEnd:${tripId}:stationaryFinalStop`;
}

function toDate(value: string | null) {
  return value ? new Date(value) : null;
}

async function getFinalStopForTrip(tripId: string) {
  const { stops } = await getStopsForTrip(tripId);
  if (stops.length === 0) return null;
  return stops[stops.length - 1] ?? null;
}

async function clearAutoEndRedisState(tripId: string) {
  await redis.del(stationaryCandidateKey(tripId));
}

async function getStationaryCandidateStartedAt(tripId: string) {
  const raw = await redis.get(stationaryCandidateKey(tripId));
  return toDate(raw);
}

async function setStationaryCandidateStartedAt(tripId: string, at: Date) {
  const ttlSeconds = Math.max(
    Number(env.TELEMATICS_AUTO_END_FINAL_STOP_STATIONARY_SECONDS ?? 120) + 300,
    600,
  );

  await redis.set(stationaryCandidateKey(tripId), at.toISOString(), {
    EX: ttlSeconds,
  });
}

export async function finalizeTripService(
  input: FinalizeTripInput,
): Promise<FinalizeTripResult> {
  const existing = await prisma.trip.findUnique({
    where: { id: input.tripId },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      status: true,
      endTime: true,
    },
  });

  if (!existing) {
    throw new Error("TRIP_NOT_FOUND");
  }

  if (existing.status === "ENDED") {
    await clearTripRealtimeState(existing.id);
    await clearTripLastGoodRealtimeState(existing.id);
    await clearTripSourceRealtimeState(existing.id, "DRIVER_MOBILE");
    await clearTripSourceRealtimeState(existing.id, "GPS_DEVICE");
    await clearAutoEndRedisState(existing.id);

    return {
      finalized: false,
      alreadyEnded: true,
      trip: {
        id: existing.id,
        routeId: existing.routeId,
        busId: existing.busId,
        driverId: existing.driverId,
        status: "ENDED",
        endTime: existing.endTime,
      },
    };
  }

  const endedAt = input.endedAt ?? new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const endedTrip = await tx.trip.update({
      where: { id: existing.id },
      data: {
        status: "ENDED",
        endTime: endedAt,
        isStale: false,
      },
      select: {
        id: true,
        routeId: true,
        busId: true,
        driverId: true,
        status: true,
        endTime: true,
      },
    });

    await tx.sourceTrackingState.updateMany({
      where: {
        busId: existing.busId,
        tripId: existing.id,
      },
      data: {
        tripId: null,
        isSelected: false,
      },
    });

    await tx.canonicalTrackingState.updateMany({
      where: {
        busId: existing.busId,
        tripId: existing.id,
      },
      data: {
        tripId: null,
        isStale: true,
      },
    });

    return endedTrip;
  });

  await Promise.all([
    clearTripRealtimeState(existing.id),
    clearTripLastGoodRealtimeState(existing.id),
    clearTripSourceRealtimeState(existing.id, "DRIVER_MOBILE"),
    clearTripSourceRealtimeState(existing.id, "GPS_DEVICE"),
    clearAutoEndRedisState(existing.id),
  ]);

  await logTripEnded({
    tripId: updated.id,
    routeId: updated.routeId,
    busId: updated.busId,
    driverId: updated.driverId,
    endedAt,
    endMode: input.endMode,
    endReason: input.endReason,
    endedBySourceType: input.endedBySourceType ?? null,
  });

  await emitTripEnded({
    tripId: updated.id,
    routeId: updated.routeId,
    busId: updated.busId,
    driverId: updated.driverId,
    status: updated.status,
    endedAt: (updated.endTime ?? endedAt).toISOString(),
    endMode: input.endMode,
    endReason: input.endReason,
    endedBySourceType: input.endedBySourceType ?? null,
  });

  await writeAuditLogSafe({
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole ?? null,
    action: "TRIP_ENDED",
    entityType: "Trip",
    entityId: updated.id,
    route: input.route ?? null,
    method: input.method ?? null,
    requestId: input.requestId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    beforeJson: {
      tripId: existing.id,
      status: existing.status,
      endTime: existing.endTime?.toISOString() ?? null,
    },
    afterJson: {
      tripId: updated.id,
      status: updated.status,
      endTime: updated.endTime?.toISOString() ?? null,
    },
    metaJson: {
      endMode: input.endMode,
      endReason: input.endReason,
      endedBySourceType: input.endedBySourceType ?? null,
      ...(typeof input.metaJson === "object" && input.metaJson !== null
        ? (input.metaJson as Record<string, unknown>)
        : { meta: input.metaJson ?? null }),
    },
  });

  return {
    finalized: true,
    alreadyEnded: false,
    trip: {
      id: updated.id,
      routeId: updated.routeId,
      busId: updated.busId,
      driverId: updated.driverId,
      status: "ENDED",
      endTime: updated.endTime,
    },
  };
}

export async function maybeAutoEndTripService(
  input: MaybeAutoEndInput,
): Promise<MaybeAutoEndResult> {
  if (!env.TELEMATICS_AUTO_END_ENABLED) {
    return {
      ended: false,
      reason: "DISABLED",
      tripId: null,
    };
  }

  if (
    env.TELEMATICS_AUTO_END_REQUIRE_HEALTHY_SOURCE &&
    input.sourceStatus !== "HEALTHY"
  ) {
    return {
      ended: false,
      reason: "SOURCE_NOT_ELIGIBLE",
      tripId: input.tripId,
    };
  }

  const trip = await prisma.trip.findUnique({
    where: { id: input.tripId },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      status: true,
      activationMode: true,
      startTime: true,
    },
  });

  if (!trip) {
    return {
      ended: false,
      reason: "TRIP_NOT_FOUND",
      tripId: null,
    };
  }

  if (trip.status !== "RUNNING") {
    await clearAutoEndRedisState(trip.id);
    return {
      ended: false,
      reason: "TRIP_NOT_RUNNING",
      tripId: trip.id,
    };
  }

  const finalStop = await getFinalStopForTrip(trip.id);

  if (!finalStop) {
    return {
      ended: false,
      reason: "NO_ROUTE_STOPS",
      tripId: trip.id,
    };
  }

  const latestArrival = await getLatestArrivedStopForTrip(trip.id);
  if (latestArrival?.stopId === finalStop.stopId) {
    const finalized = await finalizeTripService({
      tripId: trip.id,
      endedAt: input.recordedAt,
      endMode: "AUTO_TELEMATICS",
      endReason: "AUTO_FINAL_STOP_ARRIVAL",
      endedBySourceType: input.sourceType,
      actorUserId: null,
      actorRole: null,
      route: null,
      method: "SYSTEM",
      requestId: null,
      ip: null,
      userAgent: `auto-end:${input.sourceType}`,
      metaJson: {
        trigger: "final_stop_arrival_record",
        finalStopId: finalStop.stopId,
        finalStopName: finalStop.stopName,
      },
    });

    if (finalized.finalized) {
      await logSystemAlert({
        tripId: trip.id,
        routeId: trip.routeId,
        busId: trip.busId,
        driverId: trip.driverId,
        title: "Trip auto-ended at final stop",
        description: `Trip ${trip.id} was auto-ended after final stop arrival.`,
        payload: {
          endReason: "AUTO_FINAL_STOP_ARRIVAL",
          sourceType: input.sourceType,
          finalStopId: finalStop.stopId,
          finalStopName: finalStop.stopName,
          recordedAt: input.recordedAt.toISOString(),
        },
        createdAt: input.recordedAt,
      });
    }

    return {
      ended: finalized.finalized || finalized.alreadyEnded,
      reason: "AUTO_FINAL_STOP_ARRIVAL",
      tripId: trip.id,
    };
  }

  const eta = computeNextStopAndEta({
    currentLat: input.currentLat,
    currentLng: input.currentLng,
    stops: (await getStopsForTrip(trip.id)).stops,
    lastSpeedKmh: input.currentSpeedKmh,
    rollingAverageSpeedKmh: null,
    arrivalRadiusMeters: Number(env.ARRIVAL_RADIUS_METERS ?? 80),
    defaultSpeedKmh: Number(env.DEFAULT_SPEED_KMH ?? 20),
    lastArrivedStopId: latestArrival?.stopId ?? null,
  });

  const finalStopDistanceMeters = Math.round(
    haversineMeters(
      input.currentLat,
      input.currentLng,
      finalStop.lat,
      finalStop.lng,
    ),
  );

  if (eta?.finalStopReached === true) {
    const finalized = await finalizeTripService({
      tripId: trip.id,
      endedAt: input.recordedAt,
      endMode: "AUTO_TELEMATICS",
      endReason: "AUTO_FINAL_STOP_ARRIVAL",
      endedBySourceType: input.sourceType,
      actorUserId: null,
      actorRole: null,
      route: null,
      method: "SYSTEM",
      requestId: null,
      ip: null,
      userAgent: `auto-end:${input.sourceType}`,
      metaJson: {
        trigger: "eta_final_stop_reached",
        finalStopId: finalStop.stopId,
        finalStopName: finalStop.stopName,
        finalStopDistanceMeters,
      },
    });

    if (finalized.finalized) {
      await logSystemAlert({
        tripId: trip.id,
        routeId: trip.routeId,
        busId: trip.busId,
        driverId: trip.driverId,
        title: "Trip auto-ended from final stop proximity",
        description: `Trip ${trip.id} was auto-ended after final stop proximity confirmation.`,
        payload: {
          endReason: "AUTO_FINAL_STOP_ARRIVAL",
          sourceType: input.sourceType,
          finalStopId: finalStop.stopId,
          finalStopName: finalStop.stopName,
          finalStopDistanceMeters,
          recordedAt: input.recordedAt.toISOString(),
        },
        createdAt: input.recordedAt,
      });
    }

    return {
      ended: finalized.finalized || finalized.alreadyEnded,
      reason: "AUTO_FINAL_STOP_ARRIVAL",
      tripId: trip.id,
    };
  }

  const nearFinalStop =
    finalStopDistanceMeters <=
    Number(env.TELEMATICS_AUTO_END_FINAL_STOP_PROXIMITY_METERS ?? 120);

  const stationaryEnough =
    input.isStationary ||
    (input.currentSpeedKmh ?? 0) <=
      Number(env.TELEMATICS_AUTO_END_STATIONARY_SPEED_KMH ?? 4);

  if (nearFinalStop && stationaryEnough) {
    const existingCandidate = await getStationaryCandidateStartedAt(trip.id);

    if (!existingCandidate) {
      await setStationaryCandidateStartedAt(trip.id, input.recordedAt);
      return {
        ended: false,
        reason: "PENDING_FINAL_STOP_STATIONARY",
        tripId: trip.id,
      };
    }

    const stationarySeconds = Math.max(
      0,
      (input.recordedAt.getTime() - existingCandidate.getTime()) / 1000,
    );

    if (
      stationarySeconds >=
      Number(env.TELEMATICS_AUTO_END_FINAL_STOP_STATIONARY_SECONDS ?? 120)
    ) {
      const finalized = await finalizeTripService({
        tripId: trip.id,
        endedAt: input.recordedAt,
        endMode: "AUTO_TELEMATICS",
        endReason: "AUTO_FINAL_STOP_STATIONARY",
        endedBySourceType: input.sourceType,
        actorUserId: null,
        actorRole: null,
        route: null,
        method: "SYSTEM",
        requestId: null,
        ip: null,
        userAgent: `auto-end:${input.sourceType}`,
        metaJson: {
          trigger: "stationary_near_final_stop",
          finalStopId: finalStop.stopId,
          finalStopName: finalStop.stopName,
          finalStopDistanceMeters,
          stationarySeconds,
        },
      });

      if (finalized.finalized) {
        await logSystemAlert({
          tripId: trip.id,
          routeId: trip.routeId,
          busId: trip.busId,
          driverId: trip.driverId,
          title: "Trip auto-ended after final stop inactivity",
          description: `Trip ${trip.id} was auto-ended after being stationary near the final stop.`,
          payload: {
            endReason: "AUTO_FINAL_STOP_STATIONARY",
            sourceType: input.sourceType,
            finalStopId: finalStop.stopId,
            finalStopName: finalStop.stopName,
            finalStopDistanceMeters,
            stationarySeconds,
            recordedAt: input.recordedAt.toISOString(),
          },
          createdAt: input.recordedAt,
        });
      }

      return {
        ended: finalized.finalized || finalized.alreadyEnded,
        reason: "AUTO_FINAL_STOP_STATIONARY",
        tripId: trip.id,
      };
    }

    return {
      ended: false,
      reason: "PENDING_FINAL_STOP_STATIONARY",
      tripId: trip.id,
    };
  }

  await clearAutoEndRedisState(trip.id);

  return {
    ended: false,
    reason: "NO_AUTO_END_CONDITION",
    tripId: trip.id,
  };
}
