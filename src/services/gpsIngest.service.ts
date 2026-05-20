import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/appError.js";
import { arbitrateTripTrackingSource } from "./sourceArbitration.service.js";
import {
  emitTripEtaUpdated,
  emitTripLocationUpdated,
  emitTripStopArrival,
} from "../sockets/tripRealtime.js";
import { computeNextStopAndEta } from "./eta.service.js";
import { getStopsForTrip } from "./tripStopsCache.service.js";
import { getLatestArrivedStopForTrip } from "./stopArrivalProgress.service.js";
import { logEtaUpdated } from "./tripEvent.service.js";
import { maybeAutoStartTripFromTelematicsPacket } from "./telematicsLifecycle.service.js";
import { maybeAutoEndTripService } from "./tripLifecycle.service.js";
import { detectStopArrival } from "./arrival.service.js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type GpsIngestInput = {
  gpsDeviceId: string;
  deviceCode: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  recordedAt: Date;
  rawPayload: Record<string, unknown> | null;
  requestIp: string | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundNumber(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sanitizeSpeedKmh(value: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return clamp(value, 0, env.GPS_INGEST_MAX_SPEED_KMH);
}

function sanitizeHeading(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return clamp(Math.round(value), 0, 360);
}

function sanitizeAccuracy(value: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** A bus cannot plausibly move faster than this — used for outlier rejection. */
const GPS_OUTLIER_MAX_KMH = 160;

function haversineMetersLocal(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const earthRadius = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Accuracy-weighted low-pass filter for the stored/broadcast bus position.
 * Blends the new GPS fix with the previous smoothed position — trusting the
 * raw fix more when GPS accuracy is good — and heavily distrusts physically
 * impossible jumps. The raw fix is still recorded verbatim in DeviceIngestLog.
 */
function smoothGpsPosition(params: {
  rawLat: number;
  rawLng: number;
  accuracyM: number | null;
  recordedAt: Date;
  previous: { lat: number; lng: number; recordedAt: Date | null } | null;
}): { lat: number; lng: number } {
  const { rawLat, rawLng, accuracyM, recordedAt, previous } = params;

  if (!previous) {
    return { lat: rawLat, lng: rawLng };
  }

  const distanceM = haversineMetersLocal(
    previous.lat,
    previous.lng,
    rawLat,
    rawLng,
  );

  // Movement within typical GPS noise — hold position so a parked bus does
  // not visibly wobble.
  if (distanceM < 4) {
    return { lat: previous.lat, lng: previous.lng };
  }

  const elapsedSeconds = previous.recordedAt
    ? Math.max(
        1,
        (recordedAt.getTime() - previous.recordedAt.getTime()) / 1000,
      )
    : 1;
  const impliedKmh = distanceM / 1000 / (elapsedSeconds / 3600);

  let alpha: number;
  if (impliedKmh > GPS_OUTLIER_MAX_KMH) {
    // Implausible jump — distrust the spike, but still drift slightly toward
    // it so a genuine long-gap move is not permanently stuck.
    alpha = 0.15;
  } else if (accuracyM == null) {
    alpha = 0.6;
  } else if (accuracyM <= 15) {
    alpha = 0.85;
  } else if (accuracyM <= 40) {
    alpha = 0.6;
  } else if (accuracyM <= 80) {
    alpha = 0.4;
  } else {
    alpha = 0.25;
  }

  return {
    lat: alpha * rawLat + (1 - alpha) * previous.lat,
    lng: alpha * rawLng + (1 - alpha) * previous.lng,
  };
}

function deriveSourceStatus(params: {
  accuracyM: number | null;
  recordedAt: Date;
}) {
  const hardRejectAccuracy = Number(
    env.GPS_DEVICE_HARD_REJECT_ACCURACY_M ?? 300,
  );
  const maxAcceptableAccuracy = Number(
    env.GPS_DEVICE_MAX_ACCEPTABLE_ACCURACY_M ?? 150,
  );
  const staleAfterSeconds = Number(env.GPS_DEVICE_STALE_AFTER_SECONDS ?? 90);
  const disconnectAfterSeconds = Number(
    env.GPS_DEVICE_DISCONNECT_AFTER_SECONDS ?? 180,
  );

  const ageSeconds = Math.max(
    0,
    (Date.now() - params.recordedAt.getTime()) / 1000,
  );

  if (params.accuracyM != null && params.accuracyM > hardRejectAccuracy) {
    return "UNHEALTHY" as const;
  }

  if (ageSeconds > disconnectAfterSeconds) {
    return "DISCONNECTED" as const;
  }

  if (ageSeconds > staleAfterSeconds) {
    return "STALE" as const;
  }

  if (params.accuracyM != null && params.accuracyM > maxAcceptableAccuracy) {
    return "STALE" as const;
  }

  return "HEALTHY" as const;
}

function buildHealthScore(params: {
  status: "HEALTHY" | "STALE" | "UNHEALTHY" | "DISCONNECTED";
  accuracyM: number | null;
  recordedAt: Date;
}) {
  let score =
    params.status === "HEALTHY"
      ? 90
      : params.status === "STALE"
        ? 55
        : params.status === "UNHEALTHY"
          ? 20
          : 0;

  if (params.accuracyM != null) {
    if (params.accuracyM <= 10) score += 8;
    else if (params.accuracyM <= 20) score += 5;
    else if (params.accuracyM <= 50) score += 2;
    else if (params.accuracyM >= 150) score -= 10;
  }

  const ageSeconds = Math.max(
    0,
    (Date.now() - params.recordedAt.getTime()) / 1000,
  );

  if (ageSeconds <= 5) score += 2;
  else if (ageSeconds >= 120) score -= 18;
  else if (ageSeconds >= 60) score -= 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function toDecimal(value: number | null) {
  return value != null ? new Prisma.Decimal(value) : null;
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalize = (input: unknown): JsonValue => {
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "number" ||
      typeof input === "boolean"
    ) {
      return input;
    }

    if (Array.isArray(input)) {
      return input.map((item) => normalize(item));
    }

    if (typeof input === "object") {
      const output: { [key: string]: JsonValue } = {};

      for (const [key, nested] of Object.entries(
        input as Record<string, unknown>,
      )) {
        if (nested === undefined) continue;
        output[key] = normalize(nested);
      }

      return output;
    }

    return String(input);
  };

  return normalize(value) as Prisma.InputJsonValue;
}

function buildDeviceIngestLogCreateData(params: {
  gpsDeviceId: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  recordedAt: Date;
  requestIp: string | null;
  isAccepted: boolean;
  sourceStatus: "HEALTHY" | "STALE" | "UNHEALTHY" | "DISCONNECTED";
  rawPayload: Prisma.InputJsonValue | null;
  notes: string;
}): Prisma.DeviceIngestLogUncheckedCreateInput {
  const base: Prisma.DeviceIngestLogUncheckedCreateInput = {
    gpsDeviceId: params.gpsDeviceId,
    lat: new Prisma.Decimal(params.lat),
    lng: new Prisma.Decimal(params.lng),
    speedKmh: toDecimal(params.speedKmh),
    heading: params.heading,
    accuracyM: toDecimal(params.accuracyM),
    recordedAt: params.recordedAt,
    requestIp: params.requestIp,
    isAccepted: params.isAccepted,
    sourceStatus: params.sourceStatus,
    notes: params.notes,
  };

  if (params.rawPayload !== null) {
    base.rawPayload = params.rawPayload;
  }

  return base;
}

function pickCurrentSpeedKmh(params: {
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
  rawSpeedKmh: number | null;
  speedKmh: number | null;
  displaySpeedKmh: number | null;
  averageSpeedKmh: number | null;
  isStationary: boolean;
}) {
  if (params.isStationary) return 0;

  if (params.sourceType === "GPS_DEVICE") {
    return (
      params.displaySpeedKmh ??
      params.speedKmh ??
      params.rawSpeedKmh ??
      params.averageSpeedKmh
    );
  }

  const current = params.speedKmh ?? 0;
  const display = params.displaySpeedKmh ?? current;
  const average = params.averageSpeedKmh ?? display;

  if (params.rawSpeedKmh == null) {
    return roundNumber(current * 0.7 + display * 0.3, 1);
  }

  const raw = params.rawSpeedKmh;

  if (raw >= 35) {
    return roundNumber(current * 0.5 + display * 0.25 + raw * 0.25, 1);
  }

  if (raw >= 10) {
    return roundNumber(current * 0.58 + display * 0.27 + raw * 0.15, 1);
  }

  return roundNumber(current * 0.62 + display * 0.28 + average * 0.1, 1);
}

function pickEtaSpeedKmh(params: {
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
  rawSpeedKmh: number | null;
  speedKmh: number | null;
  displaySpeedKmh: number | null;
  averageSpeedKmh: number | null;
  isStationary: boolean;
}) {
  if (params.isStationary) return 0;

  if (params.sourceType === "GPS_DEVICE") {
    return (
      params.displaySpeedKmh ??
      params.speedKmh ??
      params.rawSpeedKmh ??
      params.averageSpeedKmh
    );
  }

  const current = params.speedKmh ?? 0;
  const display = params.displaySpeedKmh ?? current;
  const average = params.averageSpeedKmh ?? display;

  if (params.rawSpeedKmh != null && params.rawSpeedKmh >= 30) {
    return roundNumber(
      display * 0.45 + current * 0.35 + params.rawSpeedKmh * 0.2,
      1,
    );
  }

  return roundNumber(display * 0.5 + average * 0.35 + current * 0.15, 1);
}

async function recomputeAndPublishEtaFromCanonical(params: {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string | null;
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

  if (!eta) return null;

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

  return eta;
}

async function detectAndPublishGpsStopArrival(params: {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  currentLat: number;
  currentLng: number;
  recordedAt: Date;
}) {
  const {
    tripId,
    routeId,
    busId,
    driverId,
    currentLat,
    currentLng,
    recordedAt,
  } = params;

  const arrival = await detectStopArrival({
    tripId,
    currentLat,
    currentLng,
    recordedAt,
  });

  if (!arrival) {
    return null;
  }

  emitTripStopArrival({
    tripId,
    routeId,
    busId,
    driverId,
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

  return arrival;
}

export async function ingestGpsDeviceLocationService(input: GpsIngestInput) {
  const speedKmh = sanitizeSpeedKmh(input.speedKmh);
  const heading = sanitizeHeading(input.heading);
  const accuracyM = sanitizeAccuracy(input.accuracyM);
  const sourceStatus = deriveSourceStatus({
    accuracyM,
    recordedAt: input.recordedAt,
  });
  const healthScore = buildHealthScore({
    status: sourceStatus,
    accuracyM,
    recordedAt: input.recordedAt,
  });
  const sourceLabel = `GPS Device ${input.deviceCode}`;
  const rawPayloadJson = toPrismaJsonValue(input.rawPayload);

  const assignment = await prisma.busGpsDeviceAssignment.findFirst({
    where: {
      gpsDeviceId: input.gpsDeviceId,
      isActive: true,
      unassignedAt: null,
    },
    orderBy: {
      assignedAt: "desc",
    },
    include: {
      bus: {
        select: {
          id: true,
          busCode: true,
          plateNumber: true,
          isActive: true,
        },
      },
    },
  });

  if (!assignment) {
    await prisma.deviceIngestLog.create({
      data: buildDeviceIngestLogCreateData({
        gpsDeviceId: input.gpsDeviceId,
        lat: input.lat,
        lng: input.lng,
        speedKmh,
        heading,
        accuracyM,
        recordedAt: input.recordedAt,
        requestIp: input.requestIp,
        isAccepted: false,
        sourceStatus,
        rawPayload: rawPayloadJson,
        notes: "No active bus assignment found for GPS device",
      }),
    });

    throw new AppError({
      statusCode: 404,
      code: "GPS_DEVICE_NOT_ASSIGNED",
      message: "No active bus assignment found for this GPS device",
    });
  }

  const previousGpsSourceState = await prisma.sourceTrackingState.findUnique({
    where: {
      busId_sourceType: {
        busId: assignment.busId,
        sourceType: "GPS_DEVICE",
      },
    },
    select: {
      latitude: true,
      longitude: true,
      recordedAt: true,
    },
  });

  const runningTripBeforeAutoStart = await prisma.trip.findFirst({
    where: {
      busId: assignment.busId,
      status: "RUNNING",
    },
    orderBy: {
      startTime: "desc",
    },
    select: {
      id: true,
      routeId: true,
      driverId: true,
      status: true,
      startTime: true,
      activationMode: true,
      serviceScheduleId: true,
    },
  });

  const now = new Date();

  // Smoothed position for the stored/broadcast tracking state. DeviceIngestLog
  // keeps the raw fix; auto-start keeps using raw input independently.
  const smoothedPosition = smoothGpsPosition({
    rawLat: input.lat,
    rawLng: input.lng,
    accuracyM,
    recordedAt: input.recordedAt,
    previous:
      previousGpsSourceState?.latitude != null &&
      previousGpsSourceState.longitude != null
        ? {
            lat: Number(previousGpsSourceState.latitude),
            lng: Number(previousGpsSourceState.longitude),
            recordedAt: previousGpsSourceState.recordedAt ?? null,
          }
        : null,
  });

  await prisma.$transaction(async (tx) => {
    await tx.deviceIngestLog.create({
      data: buildDeviceIngestLogCreateData({
        gpsDeviceId: input.gpsDeviceId,
        lat: input.lat,
        lng: input.lng,
        speedKmh,
        heading,
        accuracyM,
        recordedAt: input.recordedAt,
        requestIp: input.requestIp,
        isAccepted: true,
        sourceStatus,
        rawPayload: rawPayloadJson,
        notes: runningTripBeforeAutoStart
          ? "GPS packet accepted and linked to running trip"
          : "GPS packet accepted without running trip linkage",
      }),
    });

    await tx.gpsDevice.update({
      where: { id: input.gpsDeviceId },
      data: {
        lastSeenAt: now,
        lastRecordedAt: input.recordedAt,
        lastIp: input.requestIp,
        lastStatus: sourceStatus,
        lastLat: new Prisma.Decimal(smoothedPosition.lat),
        lastLng: new Prisma.Decimal(smoothedPosition.lng),
        lastSpeedKmh: toDecimal(speedKmh),
        lastHeading: heading,
        lastAccuracyM: toDecimal(accuracyM),
      },
    });

    await tx.sourceTrackingState.upsert({
      where: {
        busId_sourceType: {
          busId: assignment.busId,
          sourceType: "GPS_DEVICE",
        },
      },
      update: {
        tripId: runningTripBeforeAutoStart?.id ?? null,
        sourceStatus,
        sourceLabel,
        gpsDeviceId: input.gpsDeviceId,
        driverId: runningTripBeforeAutoStart?.driverId ?? null,
        latitude: new Prisma.Decimal(smoothedPosition.lat),
        longitude: new Prisma.Decimal(smoothedPosition.lng),
        speedKmh: toDecimal(speedKmh),
        rawSpeedKmh: toDecimal(speedKmh),
        averageSpeedKmh: null,
        displaySpeedKmh: toDecimal(speedKmh),
        heading,
        accuracyM: toDecimal(accuracyM),
        recordedAt: input.recordedAt,
        lastSeenAt: now,
        healthScore,
        isSelected: false,
        priorityRank: 10,
      },
      create: {
        busId: assignment.busId,
        tripId: runningTripBeforeAutoStart?.id ?? null,
        sourceType: "GPS_DEVICE",
        sourceStatus,
        sourceLabel,
        gpsDeviceId: input.gpsDeviceId,
        driverId: runningTripBeforeAutoStart?.driverId ?? null,
        latitude: new Prisma.Decimal(smoothedPosition.lat),
        longitude: new Prisma.Decimal(smoothedPosition.lng),
        speedKmh: toDecimal(speedKmh),
        rawSpeedKmh: toDecimal(speedKmh),
        averageSpeedKmh: null,
        displaySpeedKmh: toDecimal(speedKmh),
        heading,
        accuracyM: toDecimal(accuracyM),
        recordedAt: input.recordedAt,
        lastSeenAt: now,
        healthScore,
        isSelected: false,
        priorityRank: 10,
      },
    });
  });

  const autoStartResult =
    runningTripBeforeAutoStart == null
      ? await maybeAutoStartTripFromTelematicsPacket({
          gpsDeviceId: input.gpsDeviceId,
          deviceCode: input.deviceCode,
          busId: assignment.busId,
          lat: input.lat,
          lng: input.lng,
          speedKmh,
          heading,
          accuracyM,
          recordedAt: input.recordedAt,
          sourceStatus,
          previousGpsState: previousGpsSourceState
            ? {
                latitude:
                  previousGpsSourceState.latitude != null
                    ? Number(previousGpsSourceState.latitude)
                    : null,
                longitude:
                  previousGpsSourceState.longitude != null
                    ? Number(previousGpsSourceState.longitude)
                    : null,
                recordedAt: previousGpsSourceState.recordedAt ?? null,
              }
            : null,
        })
      : null;

  const runningTrip =
    runningTripBeforeAutoStart ??
    (autoStartResult?.trip
      ? {
          id: autoStartResult.trip.id,
          routeId: autoStartResult.trip.routeId,
          driverId: autoStartResult.trip.driverId,
          status: "RUNNING" as const,
          startTime: input.recordedAt,
          activationMode: autoStartResult.trip.activationMode,
          serviceScheduleId: autoStartResult.trip.serviceScheduleId,
        }
      : null);

  if (runningTrip && autoStartResult?.started) {
    await prisma.sourceTrackingState.updateMany({
      where: {
        busId: assignment.busId,
        sourceType: "GPS_DEVICE",
      },
      data: {
        tripId: runningTrip.id,
        driverId: runningTrip.driverId,
      },
    });

    await prisma.canonicalTrackingState.updateMany({
      where: {
        busId: assignment.busId,
      },
      data: {
        tripId: runningTrip.id,
      },
    });
  }

  const selectedState =
    runningTrip != null
      ? await arbitrateTripTrackingSource({
          tripId: runningTrip.id,
          busId: assignment.busId,
        })
      : null;

  let autoEndResult: Awaited<
    ReturnType<typeof maybeAutoEndTripService>
  > | null = null;

  let arrival: Awaited<ReturnType<typeof detectStopArrival>> | null = null;

  if (runningTrip && selectedState) {
    const selectedRecordedAt = new Date(selectedState.recordedAt);

    emitTripLocationUpdated({
      tripId: runningTrip.id,
      routeId: runningTrip.routeId,
      busId: assignment.busId,
      driverId: runningTrip.driverId,
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
      source:
        selectedState.sourceLabel ??
        (selectedState.sourceType === "GPS_DEVICE"
          ? "GPS Device"
          : "Driver Mobile"),
      sourceType: selectedState.sourceType,
      sourceStatus: selectedState.sourceStatus,
      selectionReason: selectedState.selectionReason,
      recordedAt: selectedState.recordedAt,
    });

    arrival = await detectAndPublishGpsStopArrival({
      tripId: runningTrip.id,
      routeId: runningTrip.routeId,
      busId: assignment.busId,
      driverId: runningTrip.driverId,
      currentLat: selectedState.lat,
      currentLng: selectedState.lng,
      recordedAt: selectedRecordedAt,
    });

    await recomputeAndPublishEtaFromCanonical({
      tripId: runningTrip.id,
      routeId: runningTrip.routeId,
      busId: assignment.busId,
      driverId: runningTrip.driverId,
      sourceType: selectedState.sourceType,
      rawSpeedKmh: selectedState.rawSpeedKmh,
      speedKmh: selectedState.speedKmh,
      displaySpeedKmh: selectedState.displaySpeedKmh,
      rollingAverageSpeedKmh: selectedState.averageSpeedKmh,
      isStationary: selectedState.isStationary,
      currentLat: selectedState.lat,
      currentLng: selectedState.lng,
      updatedAt: selectedRecordedAt,
    }).catch(() => null);

    autoEndResult = await maybeAutoEndTripService({
      tripId: runningTrip.id,
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
      recordedAt: selectedRecordedAt,
    });
  }

  return {
    accepted: true,
    sourceType: "GPS_DEVICE" as const,
    sourceStatus,
    selectionDeferred: false,
    selectedSourceType: selectedState?.sourceType ?? null,
    selectedSelectionReason: selectedState?.selectionReason ?? null,
    sourceLabel,
    linkedBus: {
      id: assignment.bus.id,
      busCode: assignment.bus.busCode,
      plateNumber: assignment.bus.plateNumber,
    },
    linkedTrip: runningTrip
      ? {
          id: runningTrip.id,
          routeId: runningTrip.routeId,
          driverId: runningTrip.driverId,
          status: runningTrip.status,
          startedAt: runningTrip.startTime?.toISOString() ?? null,
          activationMode:
            "activationMode" in runningTrip ? runningTrip.activationMode : null,
        }
      : null,
    autoStart: autoStartResult
      ? {
          started: autoStartResult.started,
          reason: autoStartResult.reason,
          tripId: autoStartResult.trip?.id ?? null,
        }
      : null,
    autoEnd: autoEndResult,
    arrival: arrival
      ? {
          stopId: arrival.stopId,
          stopName: arrival.stopName,
          stopOrder: arrival.stopOrder,
          arrivalTime: arrival.arrivalTime,
          distanceMeters: arrival.distanceMeters,
          delayMinutes: arrival.delayMinutes,
          status: arrival.status,
        }
      : null,
    telemetry: {
      lat: input.lat,
      lng: input.lng,
      speedKmh,
      heading,
      accuracyM,
      recordedAt: input.recordedAt.toISOString(),
      receivedAt: now.toISOString(),
      healthScore,
    },
  };
}
