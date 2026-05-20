import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { emitTripStarted } from "../sockets/tripRealtime.js";
import {
  acquireTripStartLock,
  releaseTripStartLock,
} from "./tripLock.service.js";
import {
  beginIdempotentRequest,
  buildFingerprint,
  completeIdempotentRequest,
  failIdempotentRequest,
} from "./idempotency.service.js";
import { writeAuditLog, getRequestIp } from "./audit.service.js";
import { AppError } from "../utils/appError.js";
import { logTripStarted } from "./tripEvent.service.js";
import { getTripRealtimeState } from "./tripRealtimeState.service.js";
import { getStopsForTrip } from "./tripStopsCache.service.js";
import { computeNextStopAndEta } from "./eta.service.js";
import { env } from "../config/env.js";
import { getLatestArrivedStopForTrip } from "./stopArrivalProgress.service.js";

type RunningTripRecord = {
  id: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  status: string;
  startTime: Date | null;
  endTime: Date | null;
  serviceScheduleId?: string | null;
  activationMode?: "MANUAL_DRIVER" | "AUTO_TELEMATICS" | "MANUAL_ADMIN";
  startedByGpsDeviceId?: string | null;
  route: { routeName: string };
  bus: { busCode: string };
  driver: { fullName: string } | null;
  lastLatitude?: Prisma.Decimal | null;
  lastLongitude?: Prisma.Decimal | null;
  lastSpeedKmh?: Prisma.Decimal | null;
  lastHeading?: number | null;
  lastAccuracyM?: Prisma.Decimal | null;
  lastLocationAt?: Date | null;
  lastEtaMinutes?: number | null;
  nextStopName?: string | null;
  isStale?: boolean;
  lastTrackingSourceType?: "DRIVER_MOBILE" | "GPS_DEVICE" | null;
  lastTrackingSourceStatus?:
    | "HEALTHY"
    | "STALE"
    | "UNHEALTHY"
    | "DISCONNECTED"
    | null;
  lastTrackingSelectionReason?:
    | "DRIVER_ONLY"
    | "GPS_ONLY"
    | "GPS_PRIORITY"
    | "DRIVER_PRIORITY"
    | "GPS_FALLBACK_TO_DRIVER"
    | "DRIVER_FALLBACK_TO_GPS"
    | "MOST_RECENT_HEALTHY"
    | "NO_HEALTHY_SOURCE"
    | null;
  lastTrackingSourceLabel?: string | null;
  lastTrackingSourceRecordedAt?: Date | null;
  preferredTrackingSourceType?: "DRIVER_MOBILE" | "GPS_DEVICE" | null;
};

type PlannedScheduleRecord = {
  id: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  dayType:
    | "SUNDAY"
    | "MONDAY"
    | "TUESDAY"
    | "WEDNESDAY"
    | "THURSDAY"
    | "FRIDAY"
    | "SATURDAY";
  departureTime: Date;
  isActive: boolean;
  createdAt: Date;
  route: { routeName: string };
  bus: { busCode: string };
  driver: { fullName: string } | null;
};

export type TripActivationModeValue =
  | "MANUAL_DRIVER"
  | "AUTO_TELEMATICS"
  | "MANUAL_ADMIN";

export type TripCreateFromScheduleInput = {
  serviceScheduleId: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  startedAt: Date;
  activationMode: TripActivationModeValue;
  startedByGpsDeviceId?: string | null;
  preferredTrackingSourceType?: "DRIVER_MOBILE" | "GPS_DEVICE" | null;
};

function decimalToNumber(
  value: Prisma.Decimal | number | string | null | undefined,
) {
  if (value == null) return null;
  return Number(String(value));
}

function roundNumber(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

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

function pickBestScheduleForDriver(schedules: PlannedScheduleRecord[]) {
  if (schedules.length === 0) return null;

  const now = new Date();
  const nowSeconds = secondsSinceMidnight(now);

  const ranked = [...schedules].sort((a, b) => {
    const aSeconds = departureSeconds(a.departureTime);
    const bSeconds = departureSeconds(b.departureTime);

    const aUpcoming = aSeconds >= nowSeconds;
    const bUpcoming = bSeconds >= nowSeconds;

    if (aUpcoming !== bUpcoming) {
      return aUpcoming ? -1 : 1;
    }

    if (aUpcoming && bUpcoming) {
      return aSeconds - bSeconds;
    }

    const aDistance = Math.abs(nowSeconds - aSeconds);
    const bDistance = Math.abs(nowSeconds - bSeconds);

    if (aDistance !== bDistance) {
      return aDistance - bDistance;
    }

    if (aSeconds !== bSeconds) {
      return bSeconds - aSeconds;
    }

    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return ranked[0] ?? null;
}

async function findBestScheduleForDriverToday(driverId: string) {
  const today = new Date();
  const { getDayTypeForDate } = await import("../utils/dayType.js");
  const dayType = getDayTypeForDate(today);

  const schedules = await prisma.serviceSchedule.findMany({
    where: {
      driverId,
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

  return pickBestScheduleForDriver(schedules as PlannedScheduleRecord[]);
}

function pickCurrentSpeedKmh(params: {
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE" | null;
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
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE" | null;
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

function sourceLabelFromType(
  sourceType: "DRIVER_MOBILE" | "GPS_DEVICE" | null | undefined,
  fallback: string | null | undefined,
) {
  return (
    fallback ??
    (sourceType === "GPS_DEVICE"
      ? "GPS Device"
      : sourceType === "DRIVER_MOBILE"
        ? "Driver Mobile"
        : "DB_TRIP_SNAPSHOT")
  );
}

async function buildLiveStateForTrip(trip: RunningTripRecord) {
  const realtime = await getTripRealtimeState(trip.id);

  const latitude =
    realtime?.lat ??
    (trip.lastLatitude != null ? decimalToNumber(trip.lastLatitude) : null);

  const longitude =
    realtime?.lng ??
    (trip.lastLongitude != null ? decimalToNumber(trip.lastLongitude) : null);

  if (latitude == null || longitude == null) {
    return null;
  }

  const sourceType =
    realtime?.sourceType ?? trip.lastTrackingSourceType ?? null;
  const filteredSpeedKmh =
    realtime?.speedKmh ??
    (trip.lastSpeedKmh != null ? decimalToNumber(trip.lastSpeedKmh) : null);

  const displaySpeedKmh = realtime?.displaySpeedKmh ?? filteredSpeedKmh ?? null;
  const rawSpeedKmh = realtime?.rawSpeedKmh ?? filteredSpeedKmh ?? null;
  const averageSpeedKmh = realtime?.averageSpeedKmh ?? filteredSpeedKmh ?? null;
  const isStationary = realtime?.isStationary ?? (displaySpeedKmh ?? 0) <= 4;

  const currentSpeedKmh = pickCurrentSpeedKmh({
    sourceType,
    rawSpeedKmh,
    speedKmh: filteredSpeedKmh,
    displaySpeedKmh,
    averageSpeedKmh,
    isStationary,
  });

  const updatedAt =
    realtime?.recordedAt?.toISOString() ??
    trip.lastLocationAt?.toISOString() ??
    null;

  const sourceStatus =
    realtime?.sourceStatus ?? trip.lastTrackingSourceStatus ?? null;
  const selectionReason =
    realtime?.selectionReason ?? trip.lastTrackingSelectionReason ?? null;
  const sourceLabel = sourceLabelFromType(
    sourceType,
    realtime?.sourceLabel ?? trip.lastTrackingSourceLabel ?? null,
  );

  return {
    lat: latitude,
    lng: longitude,
    latitude,
    longitude,
    speedKmh: currentSpeedKmh,
    speed: currentSpeedKmh,
    filteredSpeedKmh,
    rawSpeedKmh,
    averageSpeedKmh,
    rollingAverageSpeedKmh: averageSpeedKmh,
    displaySpeedKmh,
    heading: realtime?.heading ?? trip.lastHeading ?? null,
    accuracyM:
      realtime?.accuracyM ??
      (trip.lastAccuracyM != null ? decimalToNumber(trip.lastAccuracyM) : null),
    recordedAt: updatedAt,
    updatedAt,
    isStationary,
    distanceDeltaMeters: realtime?.distanceDeltaMeters ?? null,
    elapsedSeconds: realtime?.elapsedSeconds ?? null,
    source: sourceLabel,
    sourceType,
    sourceStatus,
    selectionReason,
    isStale: Boolean(trip.isStale),
  };
}

async function buildEtaForTrip(
  trip: RunningTripRecord,
  liveState: Awaited<ReturnType<typeof buildLiveStateForTrip>>,
) {
  if (liveState?.latitude != null && liveState?.longitude != null) {
    try {
      const [{ stops }, latestArrival] = await Promise.all([
        getStopsForTrip(trip.id),
        getLatestArrivedStopForTrip(trip.id),
      ]);

      const computed = computeNextStopAndEta({
        currentLat: liveState.latitude,
        currentLng: liveState.longitude,
        stops,
        lastSpeedKmh: pickEtaSpeedKmh({
          sourceType: liveState.sourceType ?? null,
          rawSpeedKmh: liveState.rawSpeedKmh ?? null,
          speedKmh: liveState.filteredSpeedKmh ?? null,
          displaySpeedKmh: liveState.displaySpeedKmh ?? null,
          averageSpeedKmh:
            liveState.averageSpeedKmh ??
            liveState.rollingAverageSpeedKmh ??
            null,
          isStationary: Boolean(liveState.isStationary),
        }),
        rollingAverageSpeedKmh:
          liveState.averageSpeedKmh ?? liveState.rollingAverageSpeedKmh ?? null,
        defaultSpeedKmh: Number(env.DEFAULT_SPEED_KMH ?? 20),
        arrivalRadiusMeters: Number(env.ARRIVAL_RADIUS_METERS ?? 80),
        lastArrivedStopId: latestArrival?.stopId ?? null,
      });

      if (computed) {
        return {
          etaMinutes: computed.etaMinutes,
          nextStopName: computed.nextStop?.stopName ?? null,
          nextStopDistanceMeters: computed.nextStop?.distanceMeters ?? null,
          nearestStopName: computed.nearestStop.stopName,
          nearestStopDistanceMeters: computed.nearestStop.distanceMeters,
          usedSpeedKmh: computed.usedSpeedKmh,
          rollingAverageSpeedKmh: computed.rollingAverageSpeedKmh,
          confidence: computed.confidence,
          finalStopReached: computed.finalStopReached,
          updatedAt: liveState.updatedAt,
        };
      }
    } catch {
      // fall through to stored ETA
    }
  }

  if (trip.lastEtaMinutes != null || trip.nextStopName != null) {
    return {
      etaMinutes: trip.lastEtaMinutes ?? null,
      nextStopName: trip.nextStopName ?? null,
      nextStopDistanceMeters: null,
      nearestStopName: null,
      nearestStopDistanceMeters: null,
      usedSpeedKmh:
        trip.lastSpeedKmh != null ? decimalToNumber(trip.lastSpeedKmh) : null,
      rollingAverageSpeedKmh: liveState?.averageSpeedKmh ?? null,
      confidence: "LOW" as const,
      finalStopReached: false,
      updatedAt: trip.lastLocationAt?.toISOString() ?? null,
    };
  }

  return null;
}

async function busHasActiveGpsDevice(busId: string): Promise<boolean> {
  const assignment = await prisma.busGpsDeviceAssignment.findFirst({
    where: {
      busId,
      isActive: true,
      unassignedAt: null,
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

async function mapTrip(trip: RunningTripRecord) {
  const [liveState, gpsAssigned] = await Promise.all([
    buildLiveStateForTrip(trip),
    busHasActiveGpsDevice(trip.busId),
  ]);
  const eta = await buildEtaForTrip(trip, liveState);

  return {
    tripId: trip.id,
    isPlanned: false,
    canStart: false,
    routeId: trip.routeId,
    routeName: trip.route.routeName,
    busId: trip.busId,
    busLabel: trip.bus.busCode,
    driverId: trip.driverId,
    driverName: trip.driver?.fullName ?? null,
    status: trip.status,
    startedAt: trip.startTime?.toISOString() ?? null,
    endedAt: trip.endTime?.toISOString() ?? null,
    serviceScheduleId: trip.serviceScheduleId ?? null,
    departureTime: null,
    activationMode: trip.activationMode ?? "MANUAL_DRIVER",
    startedByGpsDeviceId: trip.startedByGpsDeviceId ?? null,
    preferredTrackingSourceType: trip.preferredTrackingSourceType ?? null,
    busHasActiveGpsDevice: gpsAssigned,
    liveState,
    eta,
  };
}

export async function createTripFromServiceSchedule(
  input: TripCreateFromScheduleInput,
) {
  // Effective initial source: AUTO_TELEMATICS implies GPS. A driverless
  // schedule (no `driverId`) must also use GPS — there's no driver phone to
  // publish from. Otherwise honour an explicit driver preference, falling
  // back to DRIVER_MOBILE.
  const initialSourceType =
    input.activationMode === "AUTO_TELEMATICS" || input.driverId == null
      ? "GPS_DEVICE"
      : (input.preferredTrackingSourceType ?? "DRIVER_MOBILE");

  const trip = await prisma.trip.create({
    data: {
      driverId: input.driverId,
      routeId: input.routeId,
      busId: input.busId,
      serviceScheduleId: input.serviceScheduleId,
      status: "RUNNING",
      startTime: input.startedAt,
      isStale: false,
      activationMode: input.activationMode,
      startedByGpsDeviceId: input.startedByGpsDeviceId ?? null,
      preferredTrackingSourceType: input.preferredTrackingSourceType ?? null,
      lastTrackingSourceType: initialSourceType,
      lastTrackingSourceStatus: "HEALTHY",
      lastTrackingSelectionReason:
        initialSourceType === "GPS_DEVICE" ? "GPS_ONLY" : "DRIVER_ONLY",
      lastTrackingSourceLabel:
        initialSourceType === "GPS_DEVICE" ? "GPS Device" : "Driver Mobile",
      lastTrackingSourceRecordedAt: input.startedAt,
    },
    include: {
      route: true,
      bus: true,
      driver: true,
    },
  });

  await logTripStarted({
    tripId: trip.id,
    routeId: trip.routeId,
    busId: trip.busId,
    driverId: trip.driverId,
    startedAt: input.startedAt,
    activationMode: input.activationMode,
    startedByGpsDeviceId: input.startedByGpsDeviceId ?? null,
  });

  emitTripStarted({
    tripId: trip.id,
    routeId: trip.routeId,
    busId: trip.busId,
    driverId: trip.driverId,
    status: trip.status,
    startedAt: input.startedAt.toISOString(),
  });

  const mapped = await mapTrip(trip);

  return {
    trip,
    mapped,
  };
}

export async function startTripService({
  driverId,
  idempotencyKey,
  preferredSourceType,
  req,
}: {
  driverId: string;
  idempotencyKey: string;
  preferredSourceType: "DRIVER_MOBILE" | "GPS_DEVICE" | null;
  req: Request;
}) {
  const fingerprint = buildFingerprint({
    action: "startTrip",
    driverId,
  });

  const idem = await beginIdempotentRequest({
    idempotencyKey,
    fingerprint,
  });

  if (idem.type === "REPLAY") {
    return {
      statusCode: idem.response.statusCode,
      body: idem.response.body,
    };
  }

  if (idem.type === "CONFLICT") {
    throw new AppError({
      statusCode: 409,
      code: "IDEMPOTENCY_CONFLICT",
      message: "Idempotency-Key already used for a different request",
    });
  }

  if (idem.type === "IN_PROGRESS") {
    throw new AppError({
      statusCode: 409,
      code: "IDEMPOTENT_REQUEST_IN_PROGRESS",
      message: "This request is already being processed",
    });
  }

  try {
    const alreadyRunningForDriver = await prisma.trip.findFirst({
      where: {
        driverId,
        status: "RUNNING",
      },
      include: {
        route: true,
        bus: true,
        driver: true,
      },
      orderBy: {
        startTime: "desc",
      },
    });

    if (alreadyRunningForDriver) {
      const mapped = await mapTrip(alreadyRunningForDriver);

      const responseBody = {
        success: true,
        message: "Trip already running",
        data: mapped,
      };

      await completeIdempotentRequest({
        idempotencyKey,
        fingerprint,
        statusCode: 200,
        body: responseBody,
      });

      return {
        statusCode: 200,
        body: responseBody,
      };
    }

    const schedule = await findBestScheduleForDriverToday(driverId);

    if (!schedule) {
      await failIdempotentRequest(idempotencyKey);

      throw new AppError({
        statusCode: 404,
        code: "NO_ASSIGNED_SCHEDULE",
        message: "No assigned active schedule for today",
      });
    }

    const lockResult = await acquireTripStartLock({
      driverId,
      busId: schedule.busId,
    });

    if (!lockResult.ok) {
      await failIdempotentRequest(idempotencyKey);

      throw new AppError({
        statusCode: 409,
        code: "TRIP_START_IN_PROGRESS",
        message: "Trip start already in progress",
        details: {
          reason: lockResult.reason,
        },
      });
    }

    try {
      const alreadyRunningForBus = await prisma.trip.findFirst({
        where: {
          busId: schedule.busId,
          status: "RUNNING",
        },
        select: {
          id: true,
          driverId: true,
        },
      });

      if (alreadyRunningForBus) {
        await failIdempotentRequest(idempotencyKey);

        throw new AppError({
          statusCode: 409,
          code: "BUS_ALREADY_IN_RUNNING_TRIP",
          message: "This bus is already assigned to a running trip",
          details: {
            runningTripId: alreadyRunningForBus.id,
            runningDriverId: alreadyRunningForBus.driverId,
          },
        });
      }

      // If the driver requested GPS_DEVICE as the source, the bus must
      // actually have an active GPS-device assignment — otherwise the trip
      // would have no live source.
      if (preferredSourceType === "GPS_DEVICE") {
        const gpsAssignment = await prisma.busGpsDeviceAssignment.findFirst({
          where: {
            busId: schedule.busId,
            isActive: true,
            unassignedAt: null,
          },
          select: { id: true },
        });

        if (!gpsAssignment) {
          await failIdempotentRequest(idempotencyKey);
          throw new AppError({
            statusCode: 400,
            code: "BUS_HAS_NO_GPS_DEVICE",
            message:
              "GPS device is not assigned to this bus. Select 'Driver mobile' as the source, or assign a GPS device first.",
          });
        }
      }

      const startedAt = new Date();

      const created = await createTripFromServiceSchedule({
        driverId,
        routeId: schedule.routeId,
        busId: schedule.busId,
        serviceScheduleId: schedule.id,
        startedAt,
        activationMode: "MANUAL_DRIVER",
        startedByGpsDeviceId: null,
        preferredTrackingSourceType: preferredSourceType,
      });

      await writeAuditLog({
        actorUserId: driverId,
        actorRole:
          (req as Request & { user?: { role?: string } }).user?.role ?? null,
        action: "TRIP_STARTED",
        entityType: "Trip",
        entityId: created.trip.id,
        route: req.originalUrl,
        method: req.method,
        requestId: (req as Request & { requestId?: string }).requestId ?? null,
        ip: getRequestIp(req),
        userAgent: req.headers["user-agent"]?.toString() ?? null,
        beforeJson: null,
        afterJson: {
          tripId: created.trip.id,
          routeId: created.trip.routeId,
          busId: created.trip.busId,
          driverId: created.trip.driverId,
          status: created.trip.status,
          startTime: created.trip.startTime?.toISOString() ?? null,
          serviceScheduleId: created.trip.serviceScheduleId,
          lastTrackingSourceType: created.trip.lastTrackingSourceType,
          lastTrackingSourceStatus: created.trip.lastTrackingSourceStatus,
          lastTrackingSelectionReason: created.trip.lastTrackingSelectionReason,
          lastTrackingSourceLabel: created.trip.lastTrackingSourceLabel,
          activationMode: created.trip.activationMode,
          startedByGpsDeviceId: created.trip.startedByGpsDeviceId,
        },
        metaJson: {
          serviceScheduleId: schedule.id,
          scheduleDayType: schedule.dayType,
          idempotencyKey,
          startMode: "MANUAL_DRIVER",
        },
      });

      const responseBody = {
        success: true,
        message: "Trip started successfully",
        data: created.mapped,
      };

      await completeIdempotentRequest({
        idempotencyKey,
        fingerprint,
        statusCode: 201,
        body: responseBody,
      });

      return {
        statusCode: 201,
        body: responseBody,
      };
    } finally {
      await releaseTripStartLock(lockResult.lock);
    }
  } catch (error) {
    await failIdempotentRequest(idempotencyKey);
    throw error;
  }
}

export async function getCurrentDriverTripService(driverId: string) {
  const running = await prisma.trip.findFirst({
    where: {
      driverId,
      status: "RUNNING",
    },
    include: {
      route: true,
      bus: true,
      driver: true,
    },
    orderBy: {
      startTime: "desc",
    },
  });

  if (running) {
    return mapTrip(running);
  }

  const schedule = await findBestScheduleForDriverToday(driverId);

  if (!schedule) {
    return null;
  }

  const gpsAssigned = await busHasActiveGpsDevice(schedule.busId);

  return {
    tripId: null,
    isPlanned: true,
    canStart: true,
    routeId: schedule.routeId,
    routeName: schedule.route.routeName,
    busId: schedule.busId,
    busLabel: schedule.bus.busCode,
    driverId,
    driverName: schedule.driver?.fullName ?? null,
    status: "PLANNED" as const,
    startedAt: null,
    endedAt: null,
    serviceScheduleId: schedule.id,
    departureTime: schedule.departureTime.toISOString(),
    activationMode: null,
    startedByGpsDeviceId: null,
    preferredTrackingSourceType: null,
    busHasActiveGpsDevice: gpsAssigned,
    liveState: null,
    eta: null,
  };
}
