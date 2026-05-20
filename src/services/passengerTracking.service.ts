import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/appError.js";
import { getStopsForTrip } from "./tripStopsCache.service.js";
import { computeNextStopAndEta } from "./eta.service.js";
import { getTripRealtimeState } from "./tripRealtimeState.service.js";
import { getLatestArrivedStopForTrip } from "./stopArrivalProgress.service.js";

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  return Number(String(value));
}

function buildEtaForTrip(params: {
  tripId: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  rollingAverageSpeedKmh: number | null;
}) {
  const { tripId, lat, lng, speedKmh, rollingAverageSpeedKmh } = params;

  return Promise.all([
    getStopsForTrip(tripId),
    getLatestArrivedStopForTrip(tripId),
  ]).then(([{ stops }, latestArrival]) => {
    const defaultSpeedKmh = Number(env.DEFAULT_SPEED_KMH ?? 20);
    const arrivalRadiusMeters = Number(env.ARRIVAL_RADIUS_METERS ?? 80);

    const input = computeNextStopAndEta({
      currentLat: lat,
      currentLng: lng,
      stops,
      lastSpeedKmh: speedKmh,
      rollingAverageSpeedKmh,
      defaultSpeedKmh,
      arrivalRadiusMeters,
      lastArrivedStopId: latestArrival?.stopId ?? null,
    });

    if (!input) return null;

    return {
      ...input,
      nextStopName: input.nextStop?.stopName ?? null,
      nextStopDistanceMeters: input.nextStop?.distanceMeters ?? null,
      nearestStopName: input.nearestStop.stopName,
      nearestStopDistanceMeters: input.nearestStop.distanceMeters,
    };
  });
}

type LiveTripSnapshotInput = {
  id: string;
  serviceScheduleId?: string | null;
  lastLatitude: unknown;
  lastLongitude: unknown;
  lastSpeedKmh: unknown;
  lastHeading: number | null;
  lastAccuracyM: unknown;
  lastLocationAt: Date | null;
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
};

async function resolveLiveSnapshot(trip: LiveTripSnapshotInput) {
  const realtime = await getTripRealtimeState(trip.id);

  if (realtime) {
    const displaySpeedKmh =
      realtime.displaySpeedKmh ?? realtime.speedKmh ?? null;

    return {
      lat: realtime.lat,
      lng: realtime.lng,
      latitude: realtime.lat,
      longitude: realtime.lng,
      speedKmh: displaySpeedKmh,
      speed: displaySpeedKmh,
      filteredSpeedKmh: realtime.speedKmh,
      rawSpeedKmh: realtime.rawSpeedKmh,
      averageSpeedKmh: realtime.averageSpeedKmh,
      rollingAverageSpeedKmh: realtime.averageSpeedKmh,
      displaySpeedKmh,
      heading: realtime.heading ?? null,
      accuracyM: realtime.accuracyM ?? null,
      isStationary: realtime.isStationary,
      distanceDeltaMeters: realtime.distanceDeltaMeters,
      elapsedSeconds: realtime.elapsedSeconds,
      recordedAt: realtime.recordedAt.toISOString(),
      updatedAt: realtime.recordedAt.toISOString(),
      source:
        realtime.sourceLabel ??
        (realtime.sourceType === "GPS_DEVICE"
          ? "GPS Device"
          : realtime.sourceType === "DRIVER_MOBILE"
            ? "Driver Mobile"
            : "Unknown Source"),
      sourceType: realtime.sourceType,
      sourceStatus: realtime.sourceStatus,
      selectionReason: realtime.selectionReason,
      isStale: Boolean(trip.isStale),
    };
  }

  if (
    trip.lastLatitude != null &&
    trip.lastLongitude != null &&
    trip.lastLocationAt != null
  ) {
    const speedKmh = toNumber(trip.lastSpeedKmh);
    const sourceType = trip.lastTrackingSourceType ?? null;
    const sourceLabel =
      trip.lastTrackingSourceLabel ??
      (sourceType === "GPS_DEVICE"
        ? "GPS Device"
        : sourceType === "DRIVER_MOBILE"
          ? "Driver Mobile"
          : "DB_TRIP_SNAPSHOT");

    return {
      lat: Number(String(trip.lastLatitude)),
      lng: Number(String(trip.lastLongitude)),
      latitude: Number(String(trip.lastLatitude)),
      longitude: Number(String(trip.lastLongitude)),
      speedKmh,
      speed: speedKmh,
      filteredSpeedKmh: speedKmh,
      rawSpeedKmh: speedKmh,
      averageSpeedKmh: speedKmh,
      rollingAverageSpeedKmh: speedKmh,
      displaySpeedKmh: speedKmh,
      heading: trip.lastHeading ?? null,
      accuracyM: toNumber(trip.lastAccuracyM),
      isStationary: (speedKmh ?? 0) <= 4,
      distanceDeltaMeters: null,
      elapsedSeconds: null,
      recordedAt: trip.lastLocationAt.toISOString(),
      updatedAt: trip.lastLocationAt.toISOString(),
      source: sourceLabel,
      sourceType,
      sourceStatus: trip.lastTrackingSourceStatus ?? null,
      selectionReason: trip.lastTrackingSelectionReason ?? null,
      isStale: Boolean(trip.isStale),
    };
  }

  return null;
}

export async function getLiveBusesByRouteService(routeId: string) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: {
      id: true,
      routeName: true,
      description: true,
      isActive: true,
    },
  });

  if (!route) {
    throw new AppError({
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: "Route not found",
    });
  }

  const trips = await prisma.trip.findMany({
    where: {
      routeId,
      status: "RUNNING",
    },
    orderBy: {
      startTime: "desc",
    },
    select: {
      id: true,
      serviceScheduleId: true,
      busId: true,
      routeId: true,
      driverId: true,
      status: true,
      startTime: true,
      endTime: true,
      lastLatitude: true,
      lastLongitude: true,
      lastSpeedKmh: true,
      lastHeading: true,
      lastAccuracyM: true,
      lastLocationAt: true,
      lastEtaMinutes: true,
      nextStopName: true,
      isStale: true,
      lastTrackingSourceType: true,
      lastTrackingSourceStatus: true,
      lastTrackingSelectionReason: true,
      lastTrackingSourceLabel: true,
      bus: {
        select: {
          id: true,
          busCode: true,
          plateNumber: true,
          capacity: true,
        },
      },
      driver: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    },
  });

  const activeTrips = await Promise.all(
    trips.map(async (trip) => {
      const live = await resolveLiveSnapshot(trip);

      let eta: unknown = null;

      if (live) {
        eta = await buildEtaForTrip({
          tripId: trip.id,
          lat: live.latitude,
          lng: live.longitude,
          speedKmh: live.displaySpeedKmh ?? live.speedKmh,
          rollingAverageSpeedKmh: live.averageSpeedKmh,
        }).catch(() => null);
      } else if (trip.lastEtaMinutes != null || trip.nextStopName != null) {
        eta = {
          etaMinutes: trip.lastEtaMinutes,
          nextStopName: trip.nextStopName ?? null,
          nextStopDistanceMeters: null,
          nearestStopName: null,
          nearestStopDistanceMeters: null,
          usedSpeedKmh:
            trip.lastSpeedKmh != null
              ? Number(String(trip.lastSpeedKmh))
              : null,
          rollingAverageSpeedKmh: null,
          confidence: "LOW" as const,
          finalStopReached: false,
        };
      }

      return {
        tripId: trip.id,
        serviceScheduleId: trip.serviceScheduleId ?? null,
        routeId: trip.routeId,
        status: trip.status,
        startedAt: trip.startTime?.toISOString() ?? null,
        endedAt: trip.endTime?.toISOString() ?? null,
        isStale: trip.isStale,
        bus: {
          id: trip.bus.id,
          busCode: trip.bus.busCode,
          plateNumber: trip.bus.plateNumber,
          capacity: trip.bus.capacity,
        },
        driver: trip.driver
          ? {
              id: trip.driver.id,
              fullName: trip.driver.fullName,
              email: trip.driver.email,
            }
          : null,
        live,
        eta,
      };
    }),
  );

  return {
    route: {
      id: route.id,
      routeName: route.routeName,
      description: route.description,
      isActive: route.isActive,
    },
    activeTrips,
  };
}

export async function getLiveTripStateService(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      serviceScheduleId: true,
      busId: true,
      routeId: true,
      driverId: true,
      status: true,
      startTime: true,
      endTime: true,
      lastLatitude: true,
      lastLongitude: true,
      lastSpeedKmh: true,
      lastHeading: true,
      lastAccuracyM: true,
      lastLocationAt: true,
      lastEtaMinutes: true,
      nextStopName: true,
      isStale: true,
      lastTrackingSourceType: true,
      lastTrackingSourceStatus: true,
      lastTrackingSelectionReason: true,
      lastTrackingSourceLabel: true,
      bus: {
        select: {
          id: true,
          busCode: true,
          plateNumber: true,
          capacity: true,
        },
      },
      route: {
        select: {
          id: true,
          routeName: true,
          description: true,
        },
      },
      driver: {
        select: {
          id: true,
          fullName: true,
          email: true,
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

  const live = await resolveLiveSnapshot(trip);

  let eta: unknown = null;

  if (live) {
    eta = await buildEtaForTrip({
      tripId: trip.id,
      lat: live.latitude,
      lng: live.longitude,
      speedKmh: live.displaySpeedKmh ?? live.speedKmh,
      rollingAverageSpeedKmh: live.averageSpeedKmh,
    }).catch(() => null);
  } else if (trip.lastEtaMinutes != null || trip.nextStopName != null) {
    eta = {
      etaMinutes: trip.lastEtaMinutes,
      nextStopName: trip.nextStopName ?? null,
      nextStopDistanceMeters: null,
      nearestStopName: null,
      nearestStopDistanceMeters: null,
      usedSpeedKmh:
        trip.lastSpeedKmh != null ? Number(String(trip.lastSpeedKmh)) : null,
      rollingAverageSpeedKmh: null,
      confidence: "LOW" as const,
      finalStopReached: false,
    };
  }

  return {
    trip: {
      id: trip.id,
      serviceScheduleId: trip.serviceScheduleId ?? null,
      status: trip.status,
      startedAt: trip.startTime?.toISOString() ?? null,
      endedAt: trip.endTime?.toISOString() ?? null,
      isStale: trip.isStale,
    },
    route: {
      id: trip.route.id,
      routeName: trip.route.routeName,
      description: trip.route.description,
    },
    bus: {
      id: trip.bus.id,
      busCode: trip.bus.busCode,
      plateNumber: trip.bus.plateNumber,
      capacity: trip.bus.capacity,
    },
    driver: trip.driver
      ? {
          id: trip.driver.id,
          fullName: trip.driver.fullName,
          email: trip.driver.email,
        }
      : null,
    live,
    eta,
  };
}

export async function getLiveTripEtaService(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      serviceScheduleId: true,
      status: true,
      lastLatitude: true,
      lastLongitude: true,
      lastSpeedKmh: true,
      lastHeading: true,
      lastAccuracyM: true,
      lastLocationAt: true,
      lastEtaMinutes: true,
      nextStopName: true,
      isStale: true,
      lastTrackingSourceType: true,
      lastTrackingSourceStatus: true,
      lastTrackingSelectionReason: true,
      lastTrackingSourceLabel: true,
    },
  });

  if (!trip) {
    throw new AppError({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
      message: "Trip not found",
    });
  }

  const live = await resolveLiveSnapshot(trip);

  if (!live) {
    return {
      tripId: trip.id,
      serviceScheduleId: trip.serviceScheduleId ?? null,
      status: trip.status,
      recordedAt: null,
      eta: null,
    };
  }

  const eta = await buildEtaForTrip({
    tripId,
    lat: live.latitude,
    lng: live.longitude,
    speedKmh: live.displaySpeedKmh ?? live.speedKmh,
    rollingAverageSpeedKmh: live.averageSpeedKmh,
  }).catch(() => null);

  return {
    tripId: trip.id,
    serviceScheduleId: trip.serviceScheduleId ?? null,
    status: trip.status,
    recordedAt: live.updatedAt,
    eta,
  };
}
