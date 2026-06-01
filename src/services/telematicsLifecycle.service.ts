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
  driverId: string | null;
  departureTime: Date;
  createdAt: Date;
  route: { id: string; routeName: string; isActive: boolean };
  bus: { id: string; busCode: string; isActive: boolean };
  driver: { id: string; fullName: string; isActive: boolean } | null;
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
    driverId: string | null;
    serviceScheduleId: string | null;
    activationMode: "MANUAL_DRIVER" | "AUTO_TELEMATICS" | "MANUAL_ADMIN";
  } | null;
};

// schedule.departureTime is stored as a Time-of-day column with the
// admin's LOCAL clock time (Dhaka, UTC+6). Prisma surfaces it as a
// Date with that local hh:mm:ss encoded in UTC. So to compare against
// `now`/`recordedAt` (which are real UTC instants), we shift the
// reference time by the Dhaka offset before extracting seconds-since-
// midnight. Otherwise a 4:30 PM Dhaka schedule only matches at
// 9:30 PM Dhaka (the 6-hour skew).
const DHAKA_OFFSET_MIN = 6 * 60;

function secondsSinceMidnight(date: Date) {
  return (
    date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()
  );
}

function dhakaSecondsSinceMidnight(date: Date) {
  const dhakaMs = date.getTime() + DHAKA_OFFSET_MIN * 60_000;
  return secondsSinceMidnight(new Date(dhakaMs));
}

function departureSeconds(date: Date) {
  // Already encoded as Dhaka local in the Time column; read it straight.
  return secondsSinceMidnight(date);
}

function pickBestScheduleForBus(
  schedules: ActiveScheduleRecord[],
  referenceTime: Date,
) {
  if (schedules.length === 0) return null;

  const nowSeconds = dhakaSecondsSinceMidnight(referenceTime);
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
      // A driver-less schedule (GPS-only bus) is valid; if a driver is
      // assigned we still require that driver to be active.
      OR: [{ driverId: null }, { driver: { isActive: true } }],
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

type MovementSample = {
  lat: number;
  lng: number;
  speedKmh: number | null;
  recordedAt: Date;
};

/** Recent accepted GPS samples for a device, oldest-first. */
async function getRecentMovementSamples(
  gpsDeviceId: string,
  before: Date,
): Promise<MovementSample[]> {
  const since = new Date(before.getTime() - 5 * 60 * 1000);

  const rows = await prisma.deviceIngestLog.findMany({
    where: {
      gpsDeviceId,
      isAccepted: true,
      lat: { not: null },
      lng: { not: null },
      recordedAt: { gte: since, lte: before },
    },
    orderBy: { recordedAt: "asc" },
    take: 12,
    select: { lat: true, lng: true, speedKmh: true, recordedAt: true },
  });

  return rows.flatMap((row) => {
    if (row.lat == null || row.lng == null || !row.recordedAt) return [];
    return [
      {
        lat: Number(row.lat),
        lng: Number(row.lng),
        speedKmh: row.speedKmh != null ? Number(row.speedKmh) : null,
        recordedAt: row.recordedAt,
      },
    ];
  });
}

/**
 * Confirms genuine vehicle movement from a short rolling window of recent
 * GPS samples rather than a single previous-vs-current comparison.
 *
 * Net displacement across the window is resistant to GPS jitter (which
 * oscillates around a point so its net displacement stays near zero), and
 * sustained speed must appear in at least two samples — so a one-off speed
 * spike cannot falsely trigger auto-start. At least two samples of
 * corroborating evidence are required overall.
 */
function isMovementConfirmed(params: {
  currentLat: number;
  currentLng: number;
  currentSpeedKmh: number | null;
  recordedAt: Date;
  recentSamples: MovementSample[];
}): boolean {
  const minSpeedKmh = Number(env.TELEMATICS_AUTO_START_MIN_SPEED_KMH ?? 8);
  const minMovementDistanceM = Number(
    env.TELEMATICS_AUTO_START_MIN_MOVEMENT_DISTANCE_M ?? 60,
  );
  const minElapsedSeconds = Number(
    env.TELEMATICS_AUTO_START_MIN_ELAPSED_SECONDS ?? 20,
  );

  const series: MovementSample[] = [
    ...params.recentSamples,
    {
      lat: params.currentLat,
      lng: params.currentLng,
      speedKmh: params.currentSpeedKmh,
      recordedAt: params.recordedAt,
    },
  ];

  // A lone packet is not enough evidence to start a trip.
  if (series.length < 2) {
    return false;
  }

  const sustainedSpeedSamples = series.filter(
    (sample) => (sample.speedKmh ?? 0) >= minSpeedKmh,
  ).length;

  if (sustainedSpeedSamples >= 2) {
    return true;
  }

  const oldest = series[0]!;
  const elapsedSeconds = Math.max(
    0,
    (params.recordedAt.getTime() - oldest.recordedAt.getTime()) / 1000,
  );

  if (elapsedSeconds < minElapsedSeconds) {
    return false;
  }

  const netDistanceMeters = haversineMeters(
    oldest.lat,
    oldest.lng,
    params.currentLat,
    params.currentLng,
  );

  return netDistanceMeters >= minMovementDistanceM;
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

  // PRE_TRIP counts as "exists" — the pre-trip window job opens those
  // rows ahead of departure, and `gpsIngest.service.ts` promotes them to
  // RUNNING via origin-dwell phase derivation. We must not create a
  // second trip here or there'd be two parallel rows for the same bus.
  const existingActiveTrip = await prisma.trip.findFirst({
    where: {
      busId: input.busId,
      status: { in: ["RUNNING", "PRE_TRIP"] },
    },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      serviceScheduleId: true,
      activationMode: true,
      status: true,
    },
    orderBy: [{ status: "desc" }, { startTime: "desc" }, { createdAt: "desc" }],
  });

  if (existingActiveTrip) {
    return {
      started: false,
      reason: "RUNNING_TRIP_EXISTS",
      trip: {
        id: existingActiveTrip.id,
        routeId: existingActiveTrip.routeId,
        busId: existingActiveTrip.busId,
        driverId: existingActiveTrip.driverId,
        serviceScheduleId: existingActiveTrip.serviceScheduleId ?? null,
        activationMode: existingActiveTrip.activationMode,
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

  const recentSamples = await getRecentMovementSamples(
    input.gpsDeviceId,
    input.recordedAt,
  );

  const movementConfirmed = isMovementConfirmed({
    currentLat: input.lat,
    currentLng: input.lng,
    currentSpeedKmh: input.speedKmh,
    recordedAt: input.recordedAt,
    recentSamples,
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
    const activeTripAfterLock = await prisma.trip.findFirst({
      where: {
        busId: input.busId,
        status: { in: ["RUNNING", "PRE_TRIP"] },
      },
      select: {
        id: true,
        routeId: true,
        busId: true,
        driverId: true,
        serviceScheduleId: true,
        activationMode: true,
        status: true,
      },
      orderBy: [
        { status: "desc" },
        { startTime: "desc" },
        { createdAt: "desc" },
      ],
    });

    if (activeTripAfterLock) {
      return {
        started: false,
        reason: "RUNNING_TRIP_EXISTS",
        trip: {
          id: activeTripAfterLock.id,
          routeId: activeTripAfterLock.routeId,
          busId: activeTripAfterLock.busId,
          driverId: activeTripAfterLock.driverId,
          serviceScheduleId: activeTripAfterLock.serviceScheduleId ?? null,
          activationMode: activeTripAfterLock.activationMode,
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
