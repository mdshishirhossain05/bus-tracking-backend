import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { haversineMeters } from "../utils/geo.js";
import { getDayTypeForDate } from "../utils/dayType.js";
import {
  acquireTripStartLock,
  releaseTripStartLock,
} from "./tripLock.service.js";
import { createTripFromServiceSchedule } from "./trip.service.js";
import { writeAuditLog } from "./audit.service.js";
import { logSystemAlert } from "./tripEvent.service.js";

type PreviousGpsState = {
  latitude: number | null;
  longitude: number | null;
  recordedAt: Date | null;
} | null;

type ActiveScheduleRecord = {
  id: string;
  routeId: string;
  busId: string;
  driverId: string;
  departureTime: Date;
  createdAt: Date;
  route: { id: string; routeName: string; isActive: boolean };
  bus: { id: string; busCode: string; isActive: boolean };
  driver: { id: string; fullName: string; isActive: boolean };
};

type MaybeAutoStartFromTelematicsInput = {
  gpsDeviceId: string;
  deviceCode: string;
  busId: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  recordedAt: Date;
  sourceStatus: "HEALTHY" | "STALE" | "UNHEALTHY" | "DISCONNECTED";
  previousGpsState: PreviousGpsState;
};

type AutoStartResult = {
  started: boolean;
  reason:
    | "DISABLED"
    | "RUNNING_TRIP_EXISTS"
    | "NO_MATCHING_SCHEDULE"
    | "NO_ROUTE_ORIGIN"
    | "OUTSIDE_ORIGIN_PROXIMITY"
    | "INSUFFICIENT_MOVEMENT"
    | "SOURCE_NOT_HEALTHY"
    | "LOCK_NOT_ACQUIRED"
    | "STARTED";
  trip: {
    id: string;
    routeId: string;
    busId: string;
    driverId: string;
    serviceScheduleId: string | null;
    activationMode: "MANUAL_DRIVER" | "AUTO_TELEMATICS" | "MANUAL_ADMIN";
  } | null;
};

function secondsSinceMidnight(date: Date) {
  return (
    date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()
  );
}

function departureSeconds(date: Date) {
  return (
    date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()
  );
}

function pickBestScheduleForBus(
  schedules: ActiveScheduleRecord[],
  referenceTime: Date,
) {
  if (schedules.length === 0) return null;

  const nowSeconds = secondsSinceMidnight(referenceTime);
  const beforeWindowSeconds =
    Number(env.TELEMATICS_AUTO_START_SCHEDULE_WINDOW_BEFORE_MINUTES ?? 30) * 60;
  const afterWindowSeconds =
    Number(env.TELEMATICS_AUTO_START_SCHEDULE_WINDOW_AFTER_MINUTES ?? 45) * 60;

  const eligible = schedules
    .map((schedule) => {
      const depSeconds = departureSeconds(schedule.departureTime);
      const deltaSeconds = nowSeconds - depSeconds;
      const withinWindow =
        deltaSeconds >= -beforeWindowSeconds &&
        deltaSeconds <= afterWindowSeconds;

      return {
        schedule,
        depSeconds,
        deltaSeconds,
        absDeltaSeconds: Math.abs(deltaSeconds),
        withinWindow,
      };
    })
    .filter((item) => item.withinWindow)
    .sort((a, b) => {
      if (a.absDeltaSeconds !== b.absDeltaSeconds) {
        return a.absDeltaSeconds - b.absDeltaSeconds;
      }

      const aPast = a.deltaSeconds >= 0;
      const bPast = b.deltaSeconds >= 0;

      if (aPast !== bPast) {
        return aPast ? -1 : 1;
      }

      if (a.depSeconds !== b.depSeconds) {
        return a.depSeconds - b.depSeconds;
      }

      return a.schedule.createdAt.getTime() - b.schedule.createdAt.getTime();
    });

  return eligible[0]?.schedule ?? null;
}

async function findBestScheduleForBusAtTime(busId: string, at: Date) {
  const dayType = getDayTypeForDate(at);

  const schedules = await prisma.serviceSchedule.findMany({
    where: {
      busId,
      dayType,
      isActive: true,
      route: { isActive: true },
      bus: { isActive: true },
      driver: { isActive: true },
    },
    include: {
      route: true,
      bus: true,
      driver: true,
    },
    orderBy: [{ departureTime: "asc" }, { createdAt: "asc" }],
  });

  return pickBestScheduleForBus(schedules as ActiveScheduleRecord[], at);
}

async function getRouteOrigin(routeId: string) {
  const firstRouteStop = await prisma.routeStop.findFirst({
    where: { routeId },
    orderBy: { stopOrder: "asc" },
    include: {
      stop: {
        select: {
          id: true,
          stopName: true,
          lat: true,
          lng: true,
        },
      },
    },
  });

  if (!firstRouteStop) return null;

  return {
    stopId: firstRouteStop.stop.id,
    stopName: firstRouteStop.stop.stopName,
    lat: Number(firstRouteStop.stop.lat),
    lng: Number(firstRouteStop.stop.lng),
    stopOrder: firstRouteStop.stopOrder,
  };
}

function isMovementConfirmed(params: {
  speedKmh: number | null;
  currentLat: number;
  currentLng: number;
  recordedAt: Date;
  previousGpsState: PreviousGpsState;
}) {
  const minSpeedKmh = Number(env.TELEMATICS_AUTO_START_MIN_SPEED_KMH ?? 8);
  const minMovementDistanceM = Number(
    env.TELEMATICS_AUTO_START_MIN_MOVEMENT_DISTANCE_M ?? 60,
  );
  const minElapsedSeconds = Number(
    env.TELEMATICS_AUTO_START_MIN_ELAPSED_SECONDS ?? 20,
  );

  if ((params.speedKmh ?? 0) >= minSpeedKmh) {
    return true;
  }

  if (
    !params.previousGpsState?.recordedAt ||
    params.previousGpsState.latitude == null ||
    params.previousGpsState.longitude == null
  ) {
    return false;
  }

  const elapsedSeconds = Math.max(
    0,
    (params.recordedAt.getTime() -
      params.previousGpsState.recordedAt.getTime()) /
      1000,
  );

  if (elapsedSeconds < minElapsedSeconds) {
    return false;
  }

  const distanceMeters = haversineMeters(
    params.previousGpsState.latitude,
    params.previousGpsState.longitude,
    params.currentLat,
    params.currentLng,
  );

  return distanceMeters >= minMovementDistanceM;
}

export async function maybeAutoStartTripFromTelematicsPacket(
  input: MaybeAutoStartFromTelematicsInput,
): Promise<AutoStartResult> {
  if (!env.TELEMATICS_AUTO_START_ENABLED) {
    return {
      started: false,
      reason: "DISABLED",
      trip: null,
    };
  }

  if (
    env.TELEMATICS_AUTO_START_REQUIRE_HEALTHY_SOURCE &&
    input.sourceStatus !== "HEALTHY"
  ) {
    return {
      started: false,
      reason: "SOURCE_NOT_HEALTHY",
      trip: null,
    };
  }

  const existingRunningTrip = await prisma.trip.findFirst({
    where: {
      busId: input.busId,
      status: "RUNNING",
    },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      serviceScheduleId: true,
      activationMode: true,
    },
    orderBy: {
      startTime: "desc",
    },
  });

  if (existingRunningTrip) {
    return {
      started: false,
      reason: "RUNNING_TRIP_EXISTS",
      trip: {
        id: existingRunningTrip.id,
        routeId: existingRunningTrip.routeId,
        busId: existingRunningTrip.busId,
        driverId: existingRunningTrip.driverId,
        serviceScheduleId: existingRunningTrip.serviceScheduleId ?? null,
        activationMode: existingRunningTrip.activationMode,
      },
    };
  }

  const schedule = await findBestScheduleForBusAtTime(
    input.busId,
    input.recordedAt,
  );

  if (!schedule) {
    return {
      started: false,
      reason: "NO_MATCHING_SCHEDULE",
      trip: null,
    };
  }

  const origin = await getRouteOrigin(schedule.routeId);

  if (!origin) {
    return {
      started: false,
      reason: "NO_ROUTE_ORIGIN",
      trip: null,
    };
  }

  const originDistanceMeters = haversineMeters(
    input.lat,
    input.lng,
    origin.lat,
    origin.lng,
  );

  if (
    originDistanceMeters >
    Number(env.TELEMATICS_AUTO_START_ORIGIN_PROXIMITY_METERS ?? 400)
  ) {
    return {
      started: false,
      reason: "OUTSIDE_ORIGIN_PROXIMITY",
      trip: null,
    };
  }

  const movementConfirmed = isMovementConfirmed({
    speedKmh: input.speedKmh,
    currentLat: input.lat,
    currentLng: input.lng,
    recordedAt: input.recordedAt,
    previousGpsState: input.previousGpsState,
  });

  if (!movementConfirmed) {
    return {
      started: false,
      reason: "INSUFFICIENT_MOVEMENT",
      trip: null,
    };
  }

  const lockResult = await acquireTripStartLock({
    driverId: schedule.driverId,
    busId: schedule.busId,
  });

  if (!lockResult.ok) {
    return {
      started: false,
      reason: "LOCK_NOT_ACQUIRED",
      trip: null,
    };
  }

  try {
    const runningTripAfterLock = await prisma.trip.findFirst({
      where: {
        busId: input.busId,
        status: "RUNNING",
      },
      select: {
        id: true,
        routeId: true,
        busId: true,
        driverId: true,
        serviceScheduleId: true,
        activationMode: true,
      },
      orderBy: {
        startTime: "desc",
      },
    });

    if (runningTripAfterLock) {
      return {
        started: false,
        reason: "RUNNING_TRIP_EXISTS",
        trip: {
          id: runningTripAfterLock.id,
          routeId: runningTripAfterLock.routeId,
          busId: runningTripAfterLock.busId,
          driverId: runningTripAfterLock.driverId,
          serviceScheduleId: runningTripAfterLock.serviceScheduleId ?? null,
          activationMode: runningTripAfterLock.activationMode,
        },
      };
    }

    const created = await createTripFromServiceSchedule({
      driverId: schedule.driverId,
      routeId: schedule.routeId,
      busId: schedule.busId,
      serviceScheduleId: schedule.id,
      startedAt: input.recordedAt,
      activationMode: "AUTO_TELEMATICS",
      startedByGpsDeviceId: input.gpsDeviceId,
    });

    await writeAuditLog({
      actorUserId: null,
      actorRole: null,
      action: "TRIP_AUTO_STARTED",
      entityType: "Trip",
      entityId: created.trip.id,
      route: null,
      method: "SYSTEM",
      requestId: null,
      ip: null,
      userAgent: `gps-device:${input.deviceCode}`,
      beforeJson: null,
      afterJson: {
        tripId: created.trip.id,
        routeId: created.trip.routeId,
        busId: created.trip.busId,
        driverId: created.trip.driverId,
        serviceScheduleId: created.trip.serviceScheduleId,
        activationMode: created.trip.activationMode,
        startedByGpsDeviceId: created.trip.startedByGpsDeviceId,
        startTime: created.trip.startTime?.toISOString() ?? null,
      },
      metaJson: {
        sourceType: "GPS_DEVICE",
        sourceStatus: input.sourceStatus,
        gpsDeviceId: input.gpsDeviceId,
        deviceCode: input.deviceCode,
        originStopId: origin.stopId,
        originStopName: origin.stopName,
        originDistanceMeters,
        speedKmh: input.speedKmh,
        heading: input.heading,
        accuracyM: input.accuracyM,
        recordedAt: input.recordedAt.toISOString(),
      },
    });

    await logSystemAlert({
      tripId: created.trip.id,
      routeId: created.trip.routeId,
      busId: created.trip.busId,
      driverId: created.trip.driverId,
      title: "Trip auto-started by telematics",
      description: `Trip ${created.trip.id} was auto-started from telematics device ${input.deviceCode}.`,
      payload: {
        activationMode: "AUTO_TELEMATICS",
        gpsDeviceId: input.gpsDeviceId,
        deviceCode: input.deviceCode,
        originDistanceMeters,
        recordedAt: input.recordedAt.toISOString(),
      },
      createdAt: input.recordedAt,
    });

    return {
      started: true,
      reason: "STARTED",
      trip: {
        id: created.trip.id,
        routeId: created.trip.routeId,
        busId: created.trip.busId,
        driverId: created.trip.driverId,
        serviceScheduleId: created.trip.serviceScheduleId ?? null,
        activationMode: "AUTO_TELEMATICS",
      },
    };
  } finally {
    await releaseTripStartLock(lockResult.lock);
  }
}
