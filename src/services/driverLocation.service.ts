import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import {
  emitTripEtaUpdated,
  emitTripLocationUpdated,
  emitTripStopArrival,
} from "../sockets/tripRealtime.js";
import { canSendLocation, isMonotonic } from "./locationRateLimiter.js";
import { detectStopArrival } from "./arrival.service.js";
import { maybePersistLocation } from "./locationBuffer.service.js";
import {
  type TripRealtimeState,
  setTripSourceRealtimeState,
} from "./tripRealtimeState.service.js";
import { computeNextStopAndEta } from "./eta.service.js";
import { getStopsForTrip } from "./tripStopsCache.service.js";
import { filterTrackingPoint } from "./trackingFilter.service.js";
import { logEtaUpdated } from "./tripEvent.service.js";
import { getLatestArrivedStopForTrip } from "./stopArrivalProgress.service.js";
import { arbitrateTripTrackingSource } from "./sourceArbitration.service.js";
import { maybeAutoEndTripService } from "./tripLifecycle.service.js";
import { applyPreTripLocationUpdate } from "./preTripPhase.service.js";
import { promotePreTripToRunning } from "./preTripPromotion.service.js";
import { triggerStopApproachAlertsService } from "./stopAlerts.service.js";
import { AppError } from "../utils/appError.js";

/**
 * Minimal logger shape so the same pipeline can be driven by an Express
 * request logger or a Socket.IO connection logger.
 */
type PipelineLogger = {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
};

export type DriverLocationInput = {
  lat: number;
  lng: number;
  speedKmh?: number | undefined;
  heading?: number | undefined;
  accuracyM?: number | undefined;
  recordedAt?: string | undefined;
};

function buildLiveSourceLabel(filteredState: {
  sourceLabel: string | null;
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
}) {
  return (
    filteredState.sourceLabel ??
    (filteredState.sourceType === "GPS_DEVICE"
      ? "GPS Device"
      : filteredState.sourceType === "DRIVER_MOBILE"
        ? "Driver Mobile"
        : "DB_TRIP_SNAPSHOT")
  );
}

function roundNumber(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pickCurrentSpeedKmh(state: {
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
  rawSpeedKmh: number | null;
  speedKmh: number | null;
  displaySpeedKmh: number | null;
  averageSpeedKmh: number | null;
  isStationary: boolean;
}) {
  if (state.isStationary) return 0;

  if (state.sourceType === "GPS_DEVICE") {
    return (
      state.displaySpeedKmh ??
      state.speedKmh ??
      state.rawSpeedKmh ??
      state.averageSpeedKmh
    );
  }

  const current = state.speedKmh ?? 0;
  const display = state.displaySpeedKmh ?? current;
  const average = state.averageSpeedKmh ?? display;

  if (state.rawSpeedKmh == null) {
    return roundNumber(current * 0.7 + display * 0.3, 1);
  }

  const raw = state.rawSpeedKmh;

  if (raw >= 35) {
    return roundNumber(current * 0.5 + display * 0.25 + raw * 0.25, 1);
  }

  if (raw >= 10) {
    return roundNumber(current * 0.58 + display * 0.27 + raw * 0.15, 1);
  }

  return roundNumber(current * 0.62 + display * 0.28 + average * 0.1, 1);
}

function pickEtaSpeedKmh(state: {
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
  rawSpeedKmh: number | null;
  speedKmh: number | null;
  displaySpeedKmh: number | null;
  averageSpeedKmh: number | null;
  isStationary: boolean;
}) {
  if (state.isStationary) return 0;

  if (state.sourceType === "GPS_DEVICE") {
    return (
      state.displaySpeedKmh ??
      state.speedKmh ??
      state.rawSpeedKmh ??
      state.averageSpeedKmh
    );
  }

  const current = state.speedKmh ?? 0;
  const display = state.displaySpeedKmh ?? current;
  const average = state.averageSpeedKmh ?? display;

  if (state.rawSpeedKmh != null && state.rawSpeedKmh >= 30) {
    return roundNumber(
      display * 0.45 + current * 0.35 + state.rawSpeedKmh * 0.2,
      1,
    );
  }

  return roundNumber(display * 0.5 + average * 0.35 + current * 0.15, 1);
}

async function recomputeAndPublishEta(params: {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string;
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
  rawSpeedKmh: number | null;
  speedKmh: number | null;
  displaySpeedKmh: number | null;
  rollingAverageSpeedKmh: number | null;
  isStationary: boolean;
  currentLat: number;
  currentLng: number;
  updatedAt: Date;
}) {
  const {
    tripId,
    routeId,
    busId,
    driverId,
    sourceType,
    rawSpeedKmh,
    speedKmh,
    displaySpeedKmh,
    rollingAverageSpeedKmh,
    isStationary,
    currentLat,
    currentLng,
    updatedAt,
  } = params;

  const [{ stops }, latestArrival] = await Promise.all([
    getStopsForTrip(tripId),
    getLatestArrivedStopForTrip(tripId),
  ]);

  const eta = computeNextStopAndEta({
    currentLat,
    currentLng,
    stops,
    lastSpeedKmh: pickEtaSpeedKmh({
      sourceType,
      rawSpeedKmh,
      speedKmh,
      displaySpeedKmh,
      averageSpeedKmh: rollingAverageSpeedKmh,
      isStationary,
    }),
    rollingAverageSpeedKmh,
    defaultSpeedKmh: Number(env.DEFAULT_SPEED_KMH ?? 20),
    arrivalRadiusMeters: Number(env.ARRIVAL_RADIUS_METERS ?? 80),
    lastArrivedStopId: latestArrival?.stopId ?? null,
  });

  if (!eta) {
    return null;
  }

  const nextStopName = eta.nextStop?.stopName ?? null;

  await prisma.trip.update({
    where: { id: tripId },
    data: {
      lastEtaMinutes: eta.etaMinutes,
      nextStopName,
    },
  });

  await logEtaUpdated({
    tripId,
    routeId,
    busId,
    driverId,
    etaMinutes: eta.etaMinutes,
    nextStopName,
    updatedAt,
  });

  emitTripEtaUpdated({
    tripId,
    etaMinutes: eta.etaMinutes,
    nextStopName,
    updatedAt: updatedAt.toISOString(),
    eta: {
      ...eta,
      nextStopName,
      nextStopDistanceMeters: eta.nextStop?.distanceMeters ?? null,
      nearestStopName: eta.nearestStop.stopName,
      nearestStopDistanceMeters: eta.nearestStop.distanceMeters,
    },
  });

  // Smart stop-approach pushes — fire-and-forget so the hot ETA path never
  // blocks on Redis/Postgres for a feature that's strictly best-effort.
  void triggerStopApproachAlertsService({
    tripId,
    routeId,
    stopEtas: eta.stopEtas,
  }).catch(() => undefined);

  return eta;
}

function liveStateResponse(state: TripRealtimeState, updatedAtIso: string) {
  const currentSpeedKmh = pickCurrentSpeedKmh({
    sourceType: state.sourceType,
    rawSpeedKmh: state.rawSpeedKmh,
    speedKmh: state.speedKmh,
    displaySpeedKmh: state.displaySpeedKmh,
    averageSpeedKmh: state.averageSpeedKmh,
    isStationary: state.isStationary,
  });

  return {
    lat: state.lat,
    lng: state.lng,
    latitude: state.lat,
    longitude: state.lng,
    speedKmh: currentSpeedKmh,
    speed: currentSpeedKmh,
    filteredSpeedKmh: state.speedKmh,
    rawSpeedKmh: state.rawSpeedKmh,
    averageSpeedKmh: state.averageSpeedKmh,
    rollingAverageSpeedKmh: state.averageSpeedKmh,
    displaySpeedKmh: state.displaySpeedKmh,
    heading: state.heading,
    accuracyM: state.accuracyM,
    isStationary: state.isStationary,
    distanceDeltaMeters: state.distanceDeltaMeters,
    elapsedSeconds: state.elapsedSeconds,
    source: buildLiveSourceLabel(state),
    sourceType: state.sourceType,
    sourceStatus: state.sourceStatus,
    selectionReason: state.selectionReason,
    updatedAt: updatedAtIso,
  };
}

/**
 * Core driver location-ingestion pipeline. Shared by the HTTP controller and
 * the Socket.IO `driver:location` handler so both transports produce identical
 * filtering, persistence, arrival detection and realtime broadcasts.
 *
 * Throws AppError for caller-recoverable conditions (rate limit, stale point,
 * not-running trip, ownership failure); the transport layer maps these to an
 * HTTP status or a socket ack rejection.
 */
export async function processDriverLocationUpdate(params: {
  driverId: string;
  tripId: string;
  input: DriverLocationInput;
  logger?: PipelineLogger | undefined;
}) {
  const { driverId, tripId, input, logger } = params;

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new AppError({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
      message: "Trip not found",
    });
  }

  if (trip.status !== "RUNNING" && trip.status !== "PRE_TRIP") {
    logger?.warn(
      { tripId, driverId, status: trip.status },
      "sendLocation on non-acceptable trip status",
    );
    throw new AppError({
      statusCode: 400,
      code: "TRIP_NOT_ACCEPTING_LOCATION",
      message: "Trip is not accepting location updates",
    });
  }

  if (trip.driverId !== driverId) {
    logger?.warn({ tripId, driverId }, "sendLocation forbidden");
    throw new AppError({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Not your trip",
    });
  }

  const key = `${driverId}:${tripId}`;

  const rate = canSendLocation(
    key,
    Number(env.LOCATION_MIN_INTERVAL_MS ?? 2000),
  );

  if (!rate.allowed) {
    logger?.warn({ tripId, driverId }, "location update rate limited");
    throw new AppError({
      statusCode: 429,
      code: rate.reason ?? "RATE_LIMITED",
      message: "Too many updates",
      details: { minIntervalMs: Number(env.LOCATION_MIN_INTERVAL_MS ?? 2000) },
    });
  }

  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();

  const monotonic = isMonotonic(key, recordedAt);

  if (!monotonic.allowed) {
    logger?.warn(
      { tripId, driverId, recordedAt: recordedAt.toISOString() },
      "stale gps point rejected",
    );

    throw new AppError({
      statusCode: 400,
      code: monotonic.reason ?? "STALE_TIMESTAMP",
      message: "Stale GPS point",
    });
  }

  const filtered = await filterTrackingPoint({
    tripId,
    lat: input.lat,
    lng: input.lng,
    speedKmh: input.speedKmh ?? null,
    heading: input.heading ?? null,
    accuracyM: input.accuracyM ?? null,
    recordedAt,
  });

  await setTripSourceRealtimeState(tripId, "DRIVER_MOBILE", filtered.state);

  await prisma.$transaction(async (tx) => {
    await tx.trip.update({
      where: { id: tripId },
      data: {
        lastLatitude: new Prisma.Decimal(filtered.state.lat),
        lastLongitude: new Prisma.Decimal(filtered.state.lng),
        lastSpeedKmh:
          filtered.state.speedKmh != null
            ? new Prisma.Decimal(filtered.state.speedKmh)
            : null,
        lastHeading: filtered.state.heading ?? null,
        lastAccuracyM:
          filtered.state.accuracyM != null
            ? new Prisma.Decimal(filtered.state.accuracyM)
            : null,
        lastLocationAt: recordedAt,
        isStale: false,
        lastTrackingSourceType: "DRIVER_MOBILE",
        lastTrackingSourceStatus: "HEALTHY",
        lastTrackingSelectionReason: "DRIVER_ONLY",
        lastTrackingSourceLabel: "Driver Mobile",
        lastTrackingSourceRecordedAt: recordedAt,
      },
    });

    await tx.sourceTrackingState.upsert({
      where: {
        busId_sourceType: {
          busId: trip.busId,
          sourceType: "DRIVER_MOBILE",
        },
      },
      update: {
        tripId: trip.id,
        sourceStatus: "HEALTHY",
        sourceLabel: "Driver Mobile",
        driverId: trip.driverId,
        gpsDeviceId: null,
        latitude: new Prisma.Decimal(filtered.state.lat),
        longitude: new Prisma.Decimal(filtered.state.lng),
        speedKmh:
          filtered.state.speedKmh != null
            ? new Prisma.Decimal(filtered.state.speedKmh)
            : null,
        rawSpeedKmh:
          filtered.state.rawSpeedKmh != null
            ? new Prisma.Decimal(filtered.state.rawSpeedKmh)
            : null,
        averageSpeedKmh:
          filtered.state.averageSpeedKmh != null
            ? new Prisma.Decimal(filtered.state.averageSpeedKmh)
            : null,
        displaySpeedKmh:
          filtered.state.displaySpeedKmh != null
            ? new Prisma.Decimal(filtered.state.displaySpeedKmh)
            : null,
        heading: filtered.state.heading,
        accuracyM:
          filtered.state.accuracyM != null
            ? new Prisma.Decimal(filtered.state.accuracyM)
            : null,
        recordedAt,
        lastSeenAt: new Date(),
        healthScore: 95,
        isSelected: false,
        priorityRank: 20,
      },
      create: {
        busId: trip.busId,
        tripId: trip.id,
        sourceType: "DRIVER_MOBILE",
        sourceStatus: "HEALTHY",
        sourceLabel: "Driver Mobile",
        driverId: trip.driverId,
        gpsDeviceId: null,
        latitude: new Prisma.Decimal(filtered.state.lat),
        longitude: new Prisma.Decimal(filtered.state.lng),
        speedKmh:
          filtered.state.speedKmh != null
            ? new Prisma.Decimal(filtered.state.speedKmh)
            : null,
        rawSpeedKmh:
          filtered.state.rawSpeedKmh != null
            ? new Prisma.Decimal(filtered.state.rawSpeedKmh)
            : null,
        averageSpeedKmh:
          filtered.state.averageSpeedKmh != null
            ? new Prisma.Decimal(filtered.state.averageSpeedKmh)
            : null,
        displaySpeedKmh:
          filtered.state.displaySpeedKmh != null
            ? new Prisma.Decimal(filtered.state.displaySpeedKmh)
            : null,
        heading: filtered.state.heading,
        accuracyM:
          filtered.state.accuracyM != null
            ? new Prisma.Decimal(filtered.state.accuracyM)
            : null,
        recordedAt,
        lastSeenAt: new Date(),
        healthScore: 95,
        isSelected: false,
        priorityRank: 20,
      },
    });
  });

  const selectedState =
    (await arbitrateTripTrackingSource({
      tripId: trip.id,
      busId: trip.busId,
    })) ?? filtered.state;

  emitTripLocationUpdated({
    tripId: trip.id,
    routeId: trip.routeId,
    busId: trip.busId,
    driverId: trip.driverId,
    lat: selectedState.lat,
    lng: selectedState.lng,
    speedKmh: pickCurrentSpeedKmh({
      sourceType: selectedState.sourceType,
      rawSpeedKmh: selectedState.rawSpeedKmh,
      speedKmh: selectedState.speedKmh,
      displaySpeedKmh: selectedState.displaySpeedKmh,
      averageSpeedKmh: selectedState.averageSpeedKmh,
      isStationary: selectedState.isStationary,
    }),
    rawSpeedKmh: selectedState.rawSpeedKmh,
    averageSpeedKmh: selectedState.averageSpeedKmh,
    displaySpeedKmh: selectedState.displaySpeedKmh,
    heading: selectedState.heading,
    accuracyM: selectedState.accuracyM,
    isStationary: selectedState.isStationary,
    distanceDeltaMeters: selectedState.distanceDeltaMeters,
    elapsedSeconds: selectedState.elapsedSeconds,
    source: buildLiveSourceLabel(selectedState),
    sourceType: selectedState.sourceType,
    sourceStatus: selectedState.sourceStatus,
    selectionReason: selectedState.selectionReason,
    recordedAt: selectedState.recordedAt,
  });

  let latestEta = null;

  try {
    latestEta = await recomputeAndPublishEta({
      tripId,
      routeId: trip.routeId,
      busId: trip.busId,
      driverId: trip.driverId,
      sourceType: selectedState.sourceType,
      rawSpeedKmh: selectedState.rawSpeedKmh,
      speedKmh: selectedState.speedKmh,
      displaySpeedKmh: selectedState.displaySpeedKmh,
      rollingAverageSpeedKmh: selectedState.averageSpeedKmh,
      isStationary: selectedState.isStationary,
      currentLat: selectedState.lat,
      currentLng: selectedState.lng,
      updatedAt: new Date(selectedState.recordedAt),
    });
  } catch (err) {
    logger?.warn({ tripId, driverId, err }, "initial eta update failed");
  }

  const persist = await maybePersistLocation({
    tripId,
    lat: selectedState.lat,
    lng: selectedState.lng,
    speedKmh: selectedState.speedKmh ?? null,
    heading: selectedState.heading ?? null,
    accuracyM: selectedState.accuracyM ?? null,
    recordedAt: new Date(selectedState.recordedAt),
  });

  let arrival: Awaited<ReturnType<typeof detectStopArrival>> | null = null;

  if (filtered.accepted) {
    arrival = await detectStopArrival({
      tripId,
      currentLat: selectedState.lat,
      currentLng: selectedState.lng,
      recordedAt: new Date(selectedState.recordedAt),
    });

    if (arrival) {
      logger?.info(
        {
          tripId,
          driverId,
          stopId: arrival.stopId,
          stopName: arrival.stopName,
          stopOrder: arrival.stopOrder,
          distanceMeters: arrival.distanceMeters,
          persisted: persist.persisted,
        },
        "stop arrival detected",
      );

      emitTripStopArrival({
        tripId,
        routeId: trip.routeId,
        busId: trip.busId,
        driverId: trip.driverId,
        stopId: arrival.stopId,
        stopName: arrival.stopName,
        stopOrder: arrival.stopOrder,
        arrivalTime: arrival.arrivalTime,
        recordedAt: arrival.arrivalTime,
        distanceMeters: arrival.distanceMeters,
        dayType: arrival.dayType,
        scheduledTime: arrival.scheduledTime,
        scheduledDateUtc: arrival.scheduledDateUtc,
        delayMinutes: arrival.delayMinutes,
        status: arrival.status,
      });

      try {
        latestEta = await recomputeAndPublishEta({
          tripId,
          routeId: trip.routeId,
          busId: trip.busId,
          driverId: trip.driverId,
          sourceType: selectedState.sourceType,
          rawSpeedKmh: selectedState.rawSpeedKmh,
          speedKmh: selectedState.speedKmh,
          displaySpeedKmh: selectedState.displaySpeedKmh,
          rollingAverageSpeedKmh: selectedState.averageSpeedKmh,
          isStationary: selectedState.isStationary,
          currentLat: selectedState.lat,
          currentLng: selectedState.lng,
          updatedAt: new Date(selectedState.recordedAt),
        });
      } catch (err) {
        logger?.warn(
          { tripId, driverId, stopId: arrival.stopId, err },
          "post-arrival eta refresh failed",
        );
      }
    }
  }

  let preTripUpdate: Awaited<
    ReturnType<typeof applyPreTripLocationUpdate>
  > | null = null;
  let preTripPromotedTripId: string | null = null;

  if (trip.status === "PRE_TRIP") {
    try {
      preTripUpdate = await applyPreTripLocationUpdate({
        tripId,
        routeId: trip.routeId,
        busId: trip.busId,
        driverId: trip.driverId,
        previousPhase: trip.preTripPhase ?? null,
        originArrivedAt: trip.originArrivedAt ?? null,
        lat: selectedState.lat,
        lng: selectedState.lng,
        speedKmh: pickCurrentSpeedKmh({
          sourceType: selectedState.sourceType,
          rawSpeedKmh: selectedState.rawSpeedKmh,
          speedKmh: selectedState.speedKmh,
          displaySpeedKmh: selectedState.displaySpeedKmh,
          averageSpeedKmh: selectedState.averageSpeedKmh,
          isStationary: selectedState.isStationary,
        }),
        recordedAt: new Date(selectedState.recordedAt),
      });

      if (preTripUpdate.shouldStartTrip) {
        await promotePreTripToRunning({
          tripId,
          startedAt: new Date(selectedState.recordedAt),
          activationMode: "AUTO_TELEMATICS",
          reason: "AUTO_ORIGIN_GEOFENCE_DWELL",
        });
        preTripPromotedTripId = tripId;
      }
    } catch (err) {
      logger?.warn(
        { tripId, driverId, err },
        "pre-trip phase update failed (non-fatal)",
      );
    }
  }

  const autoEndResult =
    trip.status === "RUNNING" || preTripPromotedTripId
      ? await maybeAutoEndTripService({
          tripId,
          sourceType: selectedState.sourceType,
          sourceStatus: selectedState.sourceStatus,
          currentLat: selectedState.lat,
          currentLng: selectedState.lng,
          currentSpeedKmh: pickCurrentSpeedKmh({
            sourceType: selectedState.sourceType,
            rawSpeedKmh: selectedState.rawSpeedKmh,
            speedKmh: selectedState.speedKmh,
            displaySpeedKmh: selectedState.displaySpeedKmh,
            averageSpeedKmh: selectedState.averageSpeedKmh,
            isStationary: selectedState.isStationary,
          }),
          isStationary: selectedState.isStationary,
          recordedAt: new Date(selectedState.recordedAt),
        })
      : null;

  return {
    recordedAt: recordedAt.toISOString(),
    persisted: persist.persisted,
    accepted: filtered.accepted,
    reason: filtered.reason ?? null,
    arrival,
    autoEnd: autoEndResult,
    preTrip: preTripUpdate
      ? {
          phase: preTripUpdate.newPhase,
          distanceToOriginMeters: preTripUpdate.distanceToOriginMeters,
          promotedToRunning: Boolean(preTripPromotedTripId),
        }
      : null,
    eta: latestEta
      ? {
          ...latestEta,
          nextStopName: latestEta.nextStop?.stopName ?? null,
          nextStopDistanceMeters: latestEta.nextStop?.distanceMeters ?? null,
          nearestStopName: latestEta.nearestStop.stopName,
          nearestStopDistanceMeters: latestEta.nearestStop.distanceMeters,
        }
      : null,
    liveState: liveStateResponse(
      selectedState,
      new Date(selectedState.recordedAt).toISOString(),
    ),
  };
}
