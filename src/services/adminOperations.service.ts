import { prisma } from "../config/prisma.js";
import { Prisma } from "@prisma/client";
import { getTripRealtimeState } from "./tripRealtimeState.service.js";
import { AppError } from "../utils/appError.js";
import { finalizeTripService } from "./tripLifecycle.service.js";
import { writeAuditLogSafe } from "./audit.service.js";
import { logSystemAlert } from "./tripEvent.service.js";
import { getIO } from "../sockets/io.js";
import { getTripRoom } from "../sockets/events.js";
import { createTripFromServiceSchedule } from "./trip.service.js";
import {
  acquireTripStartLock,
  releaseTripStartLock,
} from "./tripLock.service.js";

/**
 * Manually starts a trip from a service schedule on behalf of an admin —
 * the operational counterpart to force-end. Used when neither the driver
 * nor GPS auto-start has begun a scheduled trip.
 */
export async function startAdminTripService(input: {
  serviceScheduleId: string;
  adminUserId: string | null;
  adminRole: string | null;
  route: string | null;
  method: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}) {
  const schedule = await prisma.serviceSchedule.findUnique({
    where: { id: input.serviceScheduleId },
    include: {
      route: { select: { id: true, isActive: true, routeName: true } },
      bus: { select: { id: true, isActive: true, busCode: true } },
      driver: { select: { id: true, isActive: true, fullName: true } },
    },
  });

  if (!schedule) {
    throw new AppError({
      statusCode: 404,
      code: "SERVICE_SCHEDULE_NOT_FOUND",
      message: "Service schedule not found",
    });
  }

  if (
    !schedule.isActive ||
    !schedule.route.isActive ||
    !schedule.bus.isActive ||
    !schedule.driver.isActive
  ) {
    throw new AppError({
      statusCode: 409,
      code: "SCHEDULE_NOT_STARTABLE",
      message:
        "This schedule cannot be started because the schedule, route, bus or driver is inactive.",
    });
  }

  const lockResult = await acquireTripStartLock({
    driverId: schedule.driverId,
    busId: schedule.busId,
  });

  if (!lockResult.ok) {
    throw new AppError({
      statusCode: 409,
      code: "TRIP_START_IN_PROGRESS",
      message: "A trip start for this bus or driver is already in progress.",
    });
  }

  try {
    const runningForBus = await prisma.trip.findFirst({
      where: { busId: schedule.busId, status: "RUNNING" },
      select: { id: true },
    });
    if (runningForBus) {
      throw new AppError({
        statusCode: 409,
        code: "BUS_ALREADY_IN_RUNNING_TRIP",
        message: "This bus is already on a running trip.",
      });
    }

    const runningForDriver = await prisma.trip.findFirst({
      where: { driverId: schedule.driverId, status: "RUNNING" },
      select: { id: true },
    });
    if (runningForDriver) {
      throw new AppError({
        statusCode: 409,
        code: "DRIVER_ALREADY_IN_RUNNING_TRIP",
        message: "This driver is already on a running trip.",
      });
    }

    const created = await createTripFromServiceSchedule({
      driverId: schedule.driverId,
      routeId: schedule.routeId,
      busId: schedule.busId,
      serviceScheduleId: schedule.id,
      startedAt: new Date(),
      activationMode: "MANUAL_ADMIN",
      startedByGpsDeviceId: null,
    });

    await writeAuditLogSafe({
      actorUserId: input.adminUserId,
      actorRole: input.adminRole,
      action: "ADMIN_START_TRIP",
      entityType: "Trip",
      entityId: created.trip.id,
      route: input.route,
      method: input.method,
      requestId: input.requestId,
      ip: input.ip,
      userAgent: input.userAgent,
      metaJson: {
        serviceScheduleId: schedule.id,
        routeName: schedule.route.routeName,
        busCode: schedule.bus.busCode,
        driverName: schedule.driver.fullName,
        startMode: "MANUAL_ADMIN",
      },
    });

    return { trip: created.mapped };
  } finally {
    await releaseTripStartLock(lockResult.lock);
  }
}

/**
 * Enables or disables graceful auto-end for a specific running trip. The
 * stale-timeout safety net still applies regardless of this flag.
 */
export async function setTripAutoEndService(input: {
  tripId: string;
  disabled: boolean;
  adminUserId: string | null;
  adminRole: string | null;
  route: string | null;
  method: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}) {
  const trip = await prisma.trip.findUnique({
    where: { id: input.tripId },
    select: { id: true, status: true },
  });

  if (!trip) {
    throw new AppError({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
      message: "Trip not found",
    });
  }

  if (trip.status !== "RUNNING") {
    throw new AppError({
      statusCode: 409,
      code: "TRIP_NOT_RUNNING",
      message: "Auto-end can only be changed for a running trip.",
    });
  }

  await prisma.trip.update({
    where: { id: trip.id },
    data: { autoEndDisabled: input.disabled },
  });

  await writeAuditLogSafe({
    actorUserId: input.adminUserId,
    actorRole: input.adminRole,
    action: "ADMIN_SET_TRIP_AUTO_END",
    entityType: "Trip",
    entityId: trip.id,
    route: input.route,
    method: input.method,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
    metaJson: { autoEndDisabled: input.disabled },
  });

  return { tripId: trip.id, autoEndDisabled: input.disabled };
}

/**
 * Best-effort realtime presence snapshot from the Socket.IO server:
 * how many distinct users are connected and how many sockets are
 * currently inside each `trip:{id}` room (i.e. watching a live trip).
 */
async function getPresenceSnapshot() {
  const empty = {
    onlineUsers: 0,
    totalConnections: 0,
    liveWatchers: 0,
    tripRoomCounts: new Map<string, number>(),
  };

  try {
    const sockets = await getIO().fetchSockets();
    const onlineUserIds = new Set<string>();
    const tripRoomCounts = new Map<string, number>();
    let liveWatchers = 0;

    for (const socket of sockets) {
      const userId = socket.data?.auth?.userId;
      if (typeof userId === "string" && userId.length > 0) {
        onlineUserIds.add(userId);
      }

      let watchingTrip = false;
      for (const room of socket.rooms) {
        if (room.startsWith("trip:")) {
          tripRoomCounts.set(room, (tripRoomCounts.get(room) ?? 0) + 1);
          watchingTrip = true;
        }
      }
      if (watchingTrip) liveWatchers += 1;
    }

    return {
      onlineUsers: onlineUserIds.size,
      totalConnections: sockets.length,
      liveWatchers,
      tripRoomCounts,
    };
  } catch {
    // Socket server not initialized yet — presence is non-critical.
    return empty;
  }
}

function toNumber(value: unknown) {
  if (value == null) return null;
  const num = Number(String(value));
  return Number.isFinite(num) ? num : null;
}

function computeAgeSeconds(date: Date | null) {
  if (!date) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
}

function mapRealtimeState(
  realtime: Awaited<ReturnType<typeof getTripRealtimeState>>,
) {
  if (!realtime) return null;

  return {
    lat: realtime.lat,
    lng: realtime.lng,
    latitude: realtime.lat,
    longitude: realtime.lng,
    speedKmh: realtime.displaySpeedKmh ?? realtime.speedKmh ?? null,
    filteredSpeedKmh: realtime.speedKmh,
    rawSpeedKmh: realtime.rawSpeedKmh,
    averageSpeedKmh: realtime.averageSpeedKmh,
    displaySpeedKmh: realtime.displaySpeedKmh,
    heading: realtime.heading,
    accuracyM: realtime.accuracyM,
    isStationary: realtime.isStationary,
    distanceDeltaMeters: realtime.distanceDeltaMeters,
    elapsedSeconds: realtime.elapsedSeconds,
    recordedAt: realtime.recordedAt.toISOString(),
    ageSeconds: computeAgeSeconds(realtime.recordedAt),
    sourceType: realtime.sourceType,
    sourceStatus: realtime.sourceStatus,
    selectionReason: realtime.selectionReason,
    sourceLabel:
      realtime.sourceLabel ??
      (realtime.sourceType === "GPS_DEVICE"
        ? "GPS Device"
        : realtime.sourceType === "DRIVER_MOBILE"
          ? "Driver Mobile"
          : "Unknown Source"),
  };
}

function mapSourceTrackingState(
  sourceState: {
    sourceType: "DRIVER_MOBILE" | "GPS_DEVICE";
    sourceStatus: "HEALTHY" | "STALE" | "UNHEALTHY" | "DISCONNECTED";
    sourceLabel: string | null;
    driverId: string | null;
    gpsDeviceId: string | null;
    latitude: unknown;
    longitude: unknown;
    speedKmh: unknown;
    rawSpeedKmh: unknown;
    averageSpeedKmh: unknown;
    displaySpeedKmh: unknown;
    heading: number | null;
    accuracyM: unknown;
    recordedAt: Date | null;
    lastSeenAt: Date | null;
    healthScore: number;
    isSelected: boolean;
    priorityRank: number;
  } | null,
) {
  if (!sourceState) return null;

  return {
    sourceType: sourceState.sourceType,
    sourceStatus: sourceState.sourceStatus,
    sourceLabel:
      sourceState.sourceLabel ??
      (sourceState.sourceType === "GPS_DEVICE"
        ? "GPS Device"
        : "Driver Mobile"),
    driverId: sourceState.driverId,
    gpsDeviceId: sourceState.gpsDeviceId,
    latitude: toNumber(sourceState.latitude),
    longitude: toNumber(sourceState.longitude),
    speedKmh: toNumber(sourceState.speedKmh),
    rawSpeedKmh: toNumber(sourceState.rawSpeedKmh),
    averageSpeedKmh: toNumber(sourceState.averageSpeedKmh),
    displaySpeedKmh: toNumber(sourceState.displaySpeedKmh),
    heading: sourceState.heading,
    accuracyM: toNumber(sourceState.accuracyM),
    recordedAt: sourceState.recordedAt?.toISOString() ?? null,
    lastSeenAt: sourceState.lastSeenAt?.toISOString() ?? null,
    recordedAgeSeconds: computeAgeSeconds(sourceState.recordedAt),
    lastSeenAgeSeconds: computeAgeSeconds(sourceState.lastSeenAt),
    healthScore: sourceState.healthScore,
    isSelected: sourceState.isSelected,
    priorityRank: sourceState.priorityRank,
  };
}

async function loadTripOperationsBase(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      serviceScheduleId: true,
      status: true,
      activationMode: true,
      startedByGpsDeviceId: true,
      startTime: true,
      endTime: true,
      isStale: true,
      lastEtaMinutes: true,
      nextStopName: true,
      lastLatitude: true,
      lastLongitude: true,
      lastSpeedKmh: true,
      lastHeading: true,
      lastAccuracyM: true,
      lastLocationAt: true,
      lastTrackingSourceType: true,
      lastTrackingSourceStatus: true,
      lastTrackingSelectionReason: true,
      lastTrackingSourceLabel: true,
      lastTrackingSourceRecordedAt: true,
      route: {
        select: {
          id: true,
          routeName: true,
        },
      },
      bus: {
        select: {
          id: true,
          busCode: true,
          plateNumber: true,
        },
      },
      driver: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      sourceStates: {
        select: {
          sourceType: true,
          sourceStatus: true,
          sourceLabel: true,
          driverId: true,
          gpsDeviceId: true,
          latitude: true,
          longitude: true,
          speedKmh: true,
          rawSpeedKmh: true,
          averageSpeedKmh: true,
          displaySpeedKmh: true,
          heading: true,
          accuracyM: true,
          recordedAt: true,
          lastSeenAt: true,
          healthScore: true,
          isSelected: true,
          priorityRank: true,
        },
        orderBy: [{ priorityRank: "asc" }, { recordedAt: "desc" }],
      },
      events: {
        take: 20,
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          type: true,
          title: true,
          description: true,
          payload: true,
          createdAt: true,
        },
      },
    },
  });

  if (!trip) {
    throw new AppError({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
      message: "Trip not found",
    });
  }

  const realtime = await getTripRealtimeState(trip.id);

  const driverSource =
    trip.sourceStates.find((source) => source.sourceType === "DRIVER_MOBILE") ??
    null;

  const gpsSource =
    trip.sourceStates.find((source) => source.sourceType === "GPS_DEVICE") ??
    null;

  return {
    trip,
    realtime,
    driverSource,
    gpsSource,
  };
}

function mapSelectedSource(trip: {
  lastTrackingSourceType: "DRIVER_MOBILE" | "GPS_DEVICE" | null;
  lastTrackingSourceStatus:
    | "HEALTHY"
    | "STALE"
    | "UNHEALTHY"
    | "DISCONNECTED"
    | null;
  lastTrackingSelectionReason:
    | "DRIVER_ONLY"
    | "GPS_ONLY"
    | "GPS_PRIORITY"
    | "DRIVER_PRIORITY"
    | "GPS_FALLBACK_TO_DRIVER"
    | "DRIVER_FALLBACK_TO_GPS"
    | "MOST_RECENT_HEALTHY"
    | "NO_HEALTHY_SOURCE"
    | null;
  lastTrackingSourceLabel: string | null;
  lastTrackingSourceRecordedAt: Date | null;
  lastLocationAt: Date | null;
}) {
  if (!trip.lastTrackingSourceType) return null;

  return {
    sourceType: trip.lastTrackingSourceType,
    sourceStatus: trip.lastTrackingSourceStatus ?? null,
    selectionReason: trip.lastTrackingSelectionReason ?? null,
    sourceLabel:
      trip.lastTrackingSourceLabel ??
      (trip.lastTrackingSourceType === "GPS_DEVICE"
        ? "GPS Device"
        : "Driver Mobile"),
    recordedAt:
      trip.lastTrackingSourceRecordedAt?.toISOString() ??
      trip.lastLocationAt?.toISOString() ??
      null,
    ageSeconds: computeAgeSeconds(
      trip.lastTrackingSourceRecordedAt ?? trip.lastLocationAt ?? null,
    ),
  };
}

export async function getAdminOperationsOverviewService() {
  const trips = await prisma.trip.findMany({
    where: {
      status: {
        in: ["RUNNING", "PLANNED"],
      },
    },
    include: {
      route: {
        select: {
          id: true,
          routeName: true,
        },
      },
      bus: {
        select: {
          id: true,
          busCode: true,
          plateNumber: true,
        },
      },
      driver: {
        select: {
          id: true,
          fullName: true,
        },
      },
      sourceStates: {
        select: {
          sourceType: true,
          sourceStatus: true,
          sourceLabel: true,
          gpsDeviceId: true,
          driverId: true,
          recordedAt: true,
          lastSeenAt: true,
          healthScore: true,
          isSelected: true,
          priorityRank: true,
        },
        orderBy: [{ priorityRank: "asc" }, { recordedAt: "desc" }],
      },
    },
    orderBy: [{ status: "desc" }, { startTime: "desc" }, { createdAt: "desc" }],
  });

  const presence = await getPresenceSnapshot();

  const mappedTrips = await Promise.all(
    trips.map(async (trip) => {
      const realtime =
        trip.status === "RUNNING" ? await getTripRealtimeState(trip.id) : null;

      const latitude =
        realtime?.lat ??
        (trip.lastLatitude != null ? toNumber(trip.lastLatitude) : null);

      const longitude =
        realtime?.lng ??
        (trip.lastLongitude != null ? toNumber(trip.lastLongitude) : null);

      const speedKmh =
        realtime?.displaySpeedKmh ??
        realtime?.speedKmh ??
        (trip.lastSpeedKmh != null ? toNumber(trip.lastSpeedKmh) : null);

      const updatedAt =
        realtime?.recordedAt?.toISOString() ??
        trip.lastLocationAt?.toISOString() ??
        null;

      const selectedSource = trip.lastTrackingSourceType
        ? {
            sourceType: trip.lastTrackingSourceType,
            sourceStatus: trip.lastTrackingSourceStatus ?? null,
            selectionReason: trip.lastTrackingSelectionReason ?? null,
            sourceLabel:
              trip.lastTrackingSourceLabel ??
              (trip.lastTrackingSourceType === "GPS_DEVICE"
                ? "GPS Device"
                : "Driver Mobile"),
            recordedAt:
              trip.lastTrackingSourceRecordedAt?.toISOString() ??
              trip.lastLocationAt?.toISOString() ??
              null,
          }
        : null;

      const availableSources = trip.sourceStates.map((source) => ({
        sourceType: source.sourceType,
        sourceStatus: source.sourceStatus,
        sourceLabel:
          source.sourceLabel ??
          (source.sourceType === "GPS_DEVICE" ? "GPS Device" : "Driver Mobile"),
        driverId: source.driverId,
        gpsDeviceId: source.gpsDeviceId,
        recordedAt: source.recordedAt?.toISOString() ?? null,
        lastSeenAt: source.lastSeenAt?.toISOString() ?? null,
        healthScore: source.healthScore,
        isSelected: source.isSelected,
        priorityRank: source.priorityRank,
      }));

      return {
        tripId: trip.id,
        routeId: trip.routeId,
        routeName: trip.route.routeName,
        busId: trip.busId,
        busLabel: trip.bus.busCode,
        plateNumber: trip.bus.plateNumber,
        driverId: trip.driverId,
        driverName: trip.driver.fullName,
        status: trip.status,
        startedAt: trip.startTime?.toISOString() ?? null,
        endedAt: trip.endTime?.toISOString() ?? null,
        activationMode: trip.activationMode ?? null,
        startedByGpsDeviceId: trip.startedByGpsDeviceId ?? null,
        liveState:
          latitude != null && longitude != null
            ? {
                tripId: trip.id,
                routeId: trip.routeId,
                busId: trip.busId,
                driverId: trip.driverId,
                latitude,
                longitude,
                speedKmh,
                heading: trip.lastHeading ?? null,
                accuracyM:
                  trip.lastAccuracyM != null
                    ? toNumber(trip.lastAccuracyM)
                    : null,
                updatedAt,
              }
            : null,
        eta: {
          tripId: trip.id,
          etaMinutes: trip.lastEtaMinutes ?? null,
          nextStopName: trip.nextStopName ?? null,
          updatedAt,
        },
        selectedSource,
        availableSources,
        isStale: trip.isStale,
        autoEndDisabled: trip.autoEndDisabled,
        watcherCount: presence.tripRoomCounts.get(getTripRoom(trip.id)) ?? 0,
      };
    }),
  );

  const activeTrips = mappedTrips.filter((trip) => trip.status === "RUNNING");
  const staleTrips = mappedTrips.filter((trip) => trip.isStale);
  const connectedTrips = mappedTrips.filter(
    (trip) => trip.liveState?.updatedAt && !trip.isStale,
  );
  const gpsSelectedTrips = mappedTrips.filter(
    (trip) => trip.selectedSource?.sourceType === "GPS_DEVICE",
  );
  const driverSelectedTrips = mappedTrips.filter(
    (trip) => trip.selectedSource?.sourceType === "DRIVER_MOBILE",
  );

  const etaValues = mappedTrips
    .map((trip) => trip.eta.etaMinutes)
    .filter((value): value is number => typeof value === "number");

  const averageEtaMinutes =
    etaValues.length > 0
      ? Math.round(
          etaValues.reduce((sum, value) => sum + value, 0) / etaValues.length,
        )
      : null;

  return {
    kpis: {
      activeTrips: activeTrips.length,
      staleTrips: staleTrips.length,
      connectedTrips: connectedTrips.length,
      gpsSelectedTrips: gpsSelectedTrips.length,
      driverSelectedTrips: driverSelectedTrips.length,
      averageEtaMinutes,
      onlineUsers: presence.onlineUsers,
      liveWatchers: presence.liveWatchers,
    },
    trips: mappedTrips,
  };
}

export async function getAdminActiveTripsService() {
  const data = await getAdminOperationsOverviewService();

  return {
    count: data.trips.length,
    trips: data.trips.map((trip) => ({
      tripId: trip.tripId,
      routeId: trip.routeId,
      routeName: trip.routeName,
      busId: trip.busId,
      busLabel: trip.busLabel,
      plateNumber: trip.plateNumber,
      driverId: trip.driverId,
      driverName: trip.driverName,
      status: trip.status,
      startedAt: trip.startedAt,
      endedAt: trip.endedAt,
      activationMode: trip.activationMode,
      startedByGpsDeviceId: trip.startedByGpsDeviceId,
      isStale: trip.isStale,
      liveState: trip.liveState,
      eta: trip.eta,
      selectedSource: trip.selectedSource,
      availableSources: trip.availableSources,
    })),
  };
}

export async function getAdminOperationsEventsService(params?: {
  limit?: number;
}) {
  const limit =
    typeof params?.limit === "number" && params.limit > 0
      ? Math.min(params.limit, 100)
      : 30;

  const events = await prisma.tripEvent.findMany({
    take: limit,
    orderBy: {
      createdAt: "desc",
    },
  });

  return events.map((event) => ({
    id: event.id,
    type: event.type,
    tripId: event.tripId,
    routeId: event.routeId,
    title: event.title,
    description: event.description,
    createdAt: event.createdAt.toISOString(),
  }));
}

export async function getAdminTripSourceDiagnosticsService(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      status: true,
      startTime: true,
      endTime: true,
      isStale: true,
      lastLatitude: true,
      lastLongitude: true,
      lastSpeedKmh: true,
      lastHeading: true,
      lastAccuracyM: true,
      lastLocationAt: true,
      lastTrackingSourceType: true,
      lastTrackingSourceStatus: true,
      lastTrackingSelectionReason: true,
      lastTrackingSourceLabel: true,
      lastTrackingSourceRecordedAt: true,
      route: {
        select: {
          id: true,
          routeName: true,
        },
      },
      bus: {
        select: {
          id: true,
          busCode: true,
          plateNumber: true,
        },
      },
      driver: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      sourceStates: {
        select: {
          sourceType: true,
          sourceStatus: true,
          sourceLabel: true,
          driverId: true,
          gpsDeviceId: true,
          latitude: true,
          longitude: true,
          speedKmh: true,
          rawSpeedKmh: true,
          averageSpeedKmh: true,
          displaySpeedKmh: true,
          heading: true,
          accuracyM: true,
          recordedAt: true,
          lastSeenAt: true,
          healthScore: true,
          isSelected: true,
          priorityRank: true,
        },
        orderBy: [{ priorityRank: "asc" }, { recordedAt: "desc" }],
      },
    },
  });

  if (!trip) {
    throw new AppError({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
      message: "Trip not found",
    });
  }

  const [canonicalRealtime, activeGpsAssignment] = await Promise.all([
    getTripRealtimeState(trip.id),
    prisma.busGpsDeviceAssignment.findFirst({
      where: {
        busId: trip.busId,
        isActive: true,
        unassignedAt: null,
      },
      orderBy: {
        assignedAt: "desc",
      },
      include: {
        gpsDevice: {
          select: {
            id: true,
            deviceCode: true,
            serialNumber: true,
            displayName: true,
            vendorName: true,
            modelName: true,
            imei: true,
            isActive: true,
            lastSeenAt: true,
            lastRecordedAt: true,
            lastStatus: true,
            lastLat: true,
            lastLng: true,
            lastSpeedKmh: true,
            lastHeading: true,
            lastAccuracyM: true,
          },
        },
      },
    }),
  ]);

  const selectedSource = trip.lastTrackingSourceType
    ? {
        sourceType: trip.lastTrackingSourceType,
        sourceStatus: trip.lastTrackingSourceStatus ?? null,
        selectionReason: trip.lastTrackingSelectionReason ?? null,
        sourceLabel:
          trip.lastTrackingSourceLabel ??
          (trip.lastTrackingSourceType === "GPS_DEVICE"
            ? "GPS Device"
            : "Driver Mobile"),
        recordedAt:
          trip.lastTrackingSourceRecordedAt?.toISOString() ??
          trip.lastLocationAt?.toISOString() ??
          null,
        ageSeconds: computeAgeSeconds(
          trip.lastTrackingSourceRecordedAt ?? trip.lastLocationAt ?? null,
        ),
      }
    : null;

  const driverSource =
    trip.sourceStates.find((source) => source.sourceType === "DRIVER_MOBILE") ??
    null;

  const gpsSource =
    trip.sourceStates.find((source) => source.sourceType === "GPS_DEVICE") ??
    null;

  return {
    trip: {
      id: trip.id,
      status: trip.status,
      startedAt: trip.startTime?.toISOString() ?? null,
      endedAt: trip.endTime?.toISOString() ?? null,
      isStale: trip.isStale,
    },
    route: {
      id: trip.route.id,
      routeName: trip.route.routeName,
    },
    bus: {
      id: trip.bus.id,
      busCode: trip.bus.busCode,
      plateNumber: trip.bus.plateNumber,
    },
    driver: {
      id: trip.driver.id,
      fullName: trip.driver.fullName,
      email: trip.driver.email,
    },
    canonical: {
      selectedSource,
      liveState: canonicalRealtime
        ? mapRealtimeState(canonicalRealtime)
        : {
            latitude:
              trip.lastLatitude != null ? toNumber(trip.lastLatitude) : null,
            longitude:
              trip.lastLongitude != null ? toNumber(trip.lastLongitude) : null,
            speedKmh:
              trip.lastSpeedKmh != null ? toNumber(trip.lastSpeedKmh) : null,
            heading: trip.lastHeading ?? null,
            accuracyM:
              trip.lastAccuracyM != null ? toNumber(trip.lastAccuracyM) : null,
            recordedAt: trip.lastLocationAt?.toISOString() ?? null,
            ageSeconds: computeAgeSeconds(trip.lastLocationAt ?? null),
            sourceType: trip.lastTrackingSourceType ?? null,
            sourceStatus: trip.lastTrackingSourceStatus ?? null,
            selectionReason: trip.lastTrackingSelectionReason ?? null,
            sourceLabel: trip.lastTrackingSourceLabel ?? null,
          },
      dbSnapshot: {
        lastLatitude:
          trip.lastLatitude != null ? toNumber(trip.lastLatitude) : null,
        lastLongitude:
          trip.lastLongitude != null ? toNumber(trip.lastLongitude) : null,
        lastSpeedKmh:
          trip.lastSpeedKmh != null ? toNumber(trip.lastSpeedKmh) : null,
        lastHeading: trip.lastHeading ?? null,
        lastAccuracyM:
          trip.lastAccuracyM != null ? toNumber(trip.lastAccuracyM) : null,
        lastLocationAt: trip.lastLocationAt?.toISOString() ?? null,
      },
    },
    sources: {
      driverMobile: mapSourceTrackingState(driverSource),
      gpsDevice: mapSourceTrackingState(gpsSource),
    },
    assignment: activeGpsAssignment
      ? {
          id: activeGpsAssignment.id,
          assignedAt: activeGpsAssignment.assignedAt.toISOString(),
          notes: activeGpsAssignment.notes,
          gpsDevice: {
            id: activeGpsAssignment.gpsDevice.id,
            deviceCode: activeGpsAssignment.gpsDevice.deviceCode,
            serialNumber: activeGpsAssignment.gpsDevice.serialNumber,
            displayName: activeGpsAssignment.gpsDevice.displayName,
            vendorName: activeGpsAssignment.gpsDevice.vendorName,
            modelName: activeGpsAssignment.gpsDevice.modelName,
            imei: activeGpsAssignment.gpsDevice.imei,
            isActive: activeGpsAssignment.gpsDevice.isActive,
            lastSeenAt:
              activeGpsAssignment.gpsDevice.lastSeenAt?.toISOString() ?? null,
            lastRecordedAt:
              activeGpsAssignment.gpsDevice.lastRecordedAt?.toISOString() ??
              null,
            lastStatus: activeGpsAssignment.gpsDevice.lastStatus ?? null,
            lastLat:
              activeGpsAssignment.gpsDevice.lastLat != null
                ? toNumber(activeGpsAssignment.gpsDevice.lastLat)
                : null,
            lastLng:
              activeGpsAssignment.gpsDevice.lastLng != null
                ? toNumber(activeGpsAssignment.gpsDevice.lastLng)
                : null,
            lastSpeedKmh:
              activeGpsAssignment.gpsDevice.lastSpeedKmh != null
                ? toNumber(activeGpsAssignment.gpsDevice.lastSpeedKmh)
                : null,
            lastHeading: activeGpsAssignment.gpsDevice.lastHeading ?? null,
            lastAccuracyM:
              activeGpsAssignment.gpsDevice.lastAccuracyM != null
                ? toNumber(activeGpsAssignment.gpsDevice.lastAccuracyM)
                : null,
          },
        }
      : null,
  };
}

export async function getAdminTripOperationsDetailService(tripId: string) {
  const { trip, realtime, driverSource, gpsSource } =
    await loadTripOperationsBase(tripId);

  return {
    trip: {
      id: trip.id,
      routeId: trip.routeId,
      routeName: trip.route.routeName,
      busId: trip.busId,
      busLabel: trip.bus.busCode,
      plateNumber: trip.bus.plateNumber,
      driverId: trip.driverId,
      driverName: trip.driver.fullName,
      driverEmail: trip.driver.email,
      serviceScheduleId: trip.serviceScheduleId ?? null,
      status: trip.status,
      activationMode: trip.activationMode,
      startedByGpsDeviceId: trip.startedByGpsDeviceId ?? null,
      startedAt: trip.startTime?.toISOString() ?? null,
      endedAt: trip.endTime?.toISOString() ?? null,
      isStale: trip.isStale,
      etaMinutes: trip.lastEtaMinutes ?? null,
      nextStopName: trip.nextStopName ?? null,
    },
    canonical: {
      selectedSource: mapSelectedSource(trip),
      liveState: realtime ? mapRealtimeState(realtime) : null,
      dbSnapshot: {
        latitude:
          trip.lastLatitude != null ? toNumber(trip.lastLatitude) : null,
        longitude:
          trip.lastLongitude != null ? toNumber(trip.lastLongitude) : null,
        speedKmh:
          trip.lastSpeedKmh != null ? toNumber(trip.lastSpeedKmh) : null,
        heading: trip.lastHeading ?? null,
        accuracyM:
          trip.lastAccuracyM != null ? toNumber(trip.lastAccuracyM) : null,
        recordedAt: trip.lastLocationAt?.toISOString() ?? null,
      },
    },
    sources: {
      driverMobile: mapSourceTrackingState(driverSource),
      gpsDevice: mapSourceTrackingState(gpsSource),
    },
    recentEvents: trip.events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      description: event.description,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
    })),
    actions: {
      canForceEnd: trip.status === "RUNNING",
      canForceRecover: trip.status === "RUNNING",
    },
  };
}

export async function forceEndAdminTripService(input: {
  tripId: string;
  adminUserId: string | null;
  adminRole: string | null;
  route: string | null;
  method: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}) {
  const trip = await prisma.trip.findUnique({
    where: { id: input.tripId },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      status: true,
    },
  });

  if (!trip) {
    throw new AppError({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
      message: "Trip not found",
    });
  }

  if (trip.status !== "RUNNING" && trip.status !== "ENDED") {
    throw new AppError({
      statusCode: 409,
      code: "TRIP_FORCE_END_NOT_ALLOWED",
      message: "Only running or already-ended trips can be force-ended",
    });
  }

  const result = await finalizeTripService({
    tripId: trip.id,
    endedAt: new Date(),
    endMode: "MANUAL_ADMIN",
    endReason: "MANUAL_ADMIN",
    endedBySourceType: "SYSTEM",
    actorUserId: input.adminUserId,
    actorRole: input.adminRole,
    route: input.route,
    method: input.method,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
    metaJson: {
      trigger: "admin_force_end",
    },
  });

  await logSystemAlert({
    tripId: trip.id,
    routeId: trip.routeId,
    busId: trip.busId,
    driverId: trip.driverId,
    title: "Trip force-ended by admin",
    description: `Trip ${trip.id} was force-ended by an admin.`,
    payload: {
      trigger: "admin_force_end",
      adminUserId: input.adminUserId,
      adminRole: input.adminRole,
      alreadyEnded: result.alreadyEnded,
    },
    createdAt: new Date(),
  });

  return {
    alreadyEnded: result.alreadyEnded,
    trip: result.trip,
  };
}

export async function forceRecoverAdminTripService(input: {
  tripId: string;
  adminUserId: string | null;
  adminRole: string | null;
  route: string | null;
  method: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}) {
  const trip = await prisma.trip.findUnique({
    where: { id: input.tripId },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      status: true,
      isStale: true,
      lastTrackingSourceType: true,
    },
  });

  if (!trip) {
    throw new AppError({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
      message: "Trip not found",
    });
  }

  if (trip.status !== "RUNNING") {
    throw new AppError({
      statusCode: 409,
      code: "TRIP_FORCE_RECOVER_NOT_ALLOWED",
      message: "Only running trips can be force-recovered",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.trip.update({
      where: { id: trip.id },
      data: {
        isStale: false,
      },
    });

    await tx.sourceTrackingState.updateMany({
      where: {
        busId: trip.busId,
        tripId: trip.id,
      },
      data: {
        isSelected: false,
      },
    });

    if (trip.lastTrackingSourceType) {
      await tx.sourceTrackingState.updateMany({
        where: {
          busId: trip.busId,
          tripId: trip.id,
          sourceType: trip.lastTrackingSourceType,
        },
        data: {
          isSelected: true,
        },
      });
    }

    await tx.canonicalTrackingState.updateMany({
      where: {
        busId: trip.busId,
      },
      data: {
        tripId: trip.id,
        isStale: false,
      },
    });
  });

  await writeAuditLogSafe({
    actorUserId: input.adminUserId,
    actorRole: input.adminRole,
    action: "TRIP_FORCE_RECOVERED",
    entityType: "Trip",
    entityId: trip.id,
    route: input.route,
    method: input.method,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
    beforeJson: {
      status: trip.status,
      isStale: trip.isStale,
      lastTrackingSourceType: trip.lastTrackingSourceType,
    },
    afterJson: {
      status: trip.status,
      isStale: false,
      lastTrackingSourceType: trip.lastTrackingSourceType,
    },
    metaJson: {
      trigger: "admin_force_recover",
    },
  });

  await logSystemAlert({
    tripId: trip.id,
    routeId: trip.routeId,
    busId: trip.busId,
    driverId: trip.driverId,
    title: "Trip operational state recovered by admin",
    description: `Trip ${trip.id} operational state was force-recovered by an admin.`,
    payload: {
      trigger: "admin_force_recover",
      adminUserId: input.adminUserId,
      adminRole: input.adminRole,
    },
    createdAt: new Date(),
  });

  return {
    tripId: trip.id,
    status: trip.status,
    isStale: false,
    recoveredSelectedSourceType: trip.lastTrackingSourceType ?? null,
  };
}
