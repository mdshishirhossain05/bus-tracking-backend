import { prisma } from "../config/prisma.js";
import { haversineMeters, toNumber } from "../utils/geo.js";
import { getDayTypeForDate } from "../utils/dayType.js";
import { env } from "../config/env.js";
import { getLatestArrivedStopForTrip } from "./stopArrivalProgress.service.js";

const DHAKA_OFFSET_MIN = 6 * 60;
const PASSED_STOP_PROGRESS_BUFFER_METERS = 35;
const PASSED_STOP_MAX_DIRECT_DISTANCE_METERS = 220;

type RouteStopWithStop = {
  stopOrder: number;
  stop: {
    id: string;
    stopName: string;
    lat: unknown;
    lng: unknown;
  };
};

type NormalizedRouteStop = {
  stopOrder: number;
  stopId: string;
  stopName: string;
  lat: number;
  lng: number;
  source: RouteStopWithStop;
};

function buildScheduledDateDhaka(actualUtc: Date, scheduledTime: Date) {
  const hh = scheduledTime.getUTCHours();
  const mm = scheduledTime.getUTCMinutes();
  const ss = scheduledTime.getUTCSeconds();

  const dhakaMs = actualUtc.getTime() + DHAKA_OFFSET_MIN * 60_000;
  const dhaka = new Date(dhakaMs);

  const y = dhaka.getUTCFullYear();
  const m = dhaka.getUTCMonth();
  const d = dhaka.getUTCDate();

  const scheduledUtcMs =
    Date.UTC(y, m, d, hh, mm, ss, 0) - DHAKA_OFFSET_MIN * 60_000;

  return new Date(scheduledUtcMs);
}

function formatTimeHHMMSS(timeOnly: Date) {
  const hh = String(timeOnly.getUTCHours()).padStart(2, "0");
  const mm = String(timeOnly.getUTCMinutes()).padStart(2, "0");
  const ss = String(timeOnly.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toXYMeters(
  originLat: number,
  originLng: number,
  pointLat: number,
  pointLng: number,
) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.cos(toRadians(originLat)) * 111_320;

  return {
    x: (pointLng - originLng) * metersPerDegLng,
    y: (pointLat - originLat) * metersPerDegLat,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function projectProgressMeters(params: {
  stops: NormalizedRouteStop[];
  cumulative: number[];
  currentLat: number;
  currentLng: number;
}) {
  const { stops, cumulative, currentLat, currentLng } = params;

  if (stops.length <= 1) {
    return {
      progressMeters: 0,
      crossTrackDistanceMeters: stops[0]
        ? haversineMeters(currentLat, currentLng, stops[0].lat, stops[0].lng)
        : 0,
    };
  }

  let best: {
    progressMeters: number;
    crossTrackDistanceMeters: number;
  } | null = null;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const start = stops[i]!;
    const end = stops[i + 1]!;

    const segmentLengthMeters = haversineMeters(
      start.lat,
      start.lng,
      end.lat,
      end.lng,
    );

    if (segmentLengthMeters <= 0.000001) continue;

    const localPoint = toXYMeters(start.lat, start.lng, currentLat, currentLng);
    const localEnd = toXYMeters(start.lat, start.lng, end.lat, end.lng);
    const segLenSq = localEnd.x * localEnd.x + localEnd.y * localEnd.y;

    if (segLenSq <= 0.000001) continue;

    const rawT =
      (localPoint.x * localEnd.x + localPoint.y * localEnd.y) / segLenSq;
    const t = clamp(rawT, 0, 1);

    const projectedX = localEnd.x * t;
    const projectedY = localEnd.y * t;

    const projectedLat = start.lat + projectedY / 111_320;
    const projectedLng =
      start.lng + projectedX / (Math.cos(toRadians(start.lat)) * 111_320);

    const crossTrackDistanceMeters = haversineMeters(
      currentLat,
      currentLng,
      projectedLat,
      projectedLng,
    );

    const progressMeters = cumulative[i]! + segmentLengthMeters * t;

    if (!best || crossTrackDistanceMeters < best.crossTrackDistanceMeters) {
      best = { progressMeters, crossTrackDistanceMeters };
    }
  }

  return best ?? { progressMeters: 0, crossTrackDistanceMeters: 0 };
}

function buildNormalizedRouteStops(routeStops: RouteStopWithStop[]) {
  return routeStops
    .map((rs) => ({
      stopOrder: rs.stopOrder,
      stopId: rs.stop.id,
      stopName: rs.stop.stopName,
      lat: toNumber(rs.stop.lat),
      lng: toNumber(rs.stop.lng),
      source: rs,
    }))
    .filter((rs) => {
      return (
        Number.isFinite(rs.lat) &&
        Number.isFinite(rs.lng) &&
        rs.lat >= -90 &&
        rs.lat <= 90 &&
        rs.lng >= -180 &&
        rs.lng <= 180
      );
    })
    .sort((a, b) => a.stopOrder - b.stopOrder);
}

function buildCumulativeDistances(stops: NormalizedRouteStop[]) {
  const cumulative: number[] = [0];

  for (let i = 1; i < stops.length; i += 1) {
    const prev = stops[i - 1]!;
    const curr = stops[i]!;

    cumulative.push(
      cumulative[i - 1]! +
        haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng),
    );
  }

  return cumulative;
}

async function createStopArrival(params: {
  tripId: string;
  routeId: string;
  stop: NormalizedRouteStop;
  distanceMeters: number;
  recordedAt: Date;
}) {
  const { tripId, routeId, stop, distanceMeters, recordedAt } = params;

  const existing = await prisma.stopArrival.findUnique({
    where: { tripId_stopId: { tripId, stopId: stop.stopId } },
  });

  if (existing) return null;

  const dayType = getDayTypeForDate(recordedAt);

  const schedules = await prisma.schedule.findMany({
    where: {
      routeId,
      stopId: stop.stopId,
      dayType,
    },
    orderBy: { scheduledTime: "asc" },
  });

  let chosenSchedule: (typeof schedules)[number] | null = null;
  let chosenScheduledUtc: Date | null = null;

  if (schedules.length > 0) {
    let bestAbsMs = Number.POSITIVE_INFINITY;

    for (const sch of schedules) {
      const scheduledUtc = buildScheduledDateDhaka(
        recordedAt,
        sch.scheduledTime,
      );
      const diffMs = recordedAt.getTime() - scheduledUtc.getTime();
      const absMs = Math.abs(diffMs);

      if (absMs < bestAbsMs) {
        bestAbsMs = absMs;
        chosenSchedule = sch;
        chosenScheduledUtc = scheduledUtc;
      }
    }
  }

  const delayMinutes =
    chosenScheduledUtc != null
      ? Math.round(
          (recordedAt.getTime() - chosenScheduledUtc.getTime()) / 60000,
        )
      : 0;

  const createData: {
    tripId: string;
    stopId: string;
    actualArrivalTime: Date;
    delayMinutes: number;
    scheduledTime?: Date;
  } = {
    tripId,
    stopId: stop.stopId,
    actualArrivalTime: recordedAt,
    delayMinutes,
  };

  if (chosenSchedule) {
    createData.scheduledTime = chosenSchedule.scheduledTime;
  }

  await prisma.stopArrival.create({ data: createData });

  return {
    tripId,
    stopId: stop.stopId,
    stopName: stop.stopName,
    stopOrder: stop.stopOrder,
    arrivalTime: recordedAt.toISOString(),
    distanceMeters: Math.round(distanceMeters),
    dayType,
    scheduledTime: chosenSchedule
      ? formatTimeHHMMSS(chosenSchedule.scheduledTime)
      : null,
    scheduledDateUtc: chosenScheduledUtc
      ? chosenScheduledUtc.toISOString()
      : null,
    delayMinutes,
    status:
      chosenSchedule == null
        ? "NO_SCHEDULE"
        : delayMinutes > 0
          ? "LATE"
          : delayMinutes < 0
            ? "EARLY"
            : "ON_TIME",
  };
}

export async function detectStopArrival(opts: {
  tripId: string;
  currentLat: number;
  currentLng: number;
  recordedAt: Date;
}) {
  const { tripId, currentLat, currentLng, recordedAt } = opts;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      route: {
        include: {
          routeStops: {
            orderBy: { stopOrder: "asc" },
            include: { stop: true },
          },
        },
      },
    },
  });

  if (!trip) return null;

  const routeStops = buildNormalizedRouteStops(trip.route.routeStops);
  if (routeStops.length === 0) return null;

  const latestArrival = await getLatestArrivedStopForTrip(tripId);
  const latestArrivalIndex = latestArrival
    ? routeStops.findIndex((rs) => rs.stopId === latestArrival.stopId)
    : -1;
  const expectedIndex = latestArrivalIndex + 1;

  if (expectedIndex >= routeStops.length) return null;

  const radius = Number(env.ARRIVAL_RADIUS_METERS ?? 80);
  const expectedStop = routeStops[expectedIndex]!;
  const expectedDistanceMeters = haversineMeters(
    currentLat,
    currentLng,
    expectedStop.lat,
    expectedStop.lng,
  );

  if (expectedDistanceMeters <= radius) {
    return createStopArrival({
      tripId,
      routeId: trip.routeId,
      stop: expectedStop,
      distanceMeters: expectedDistanceMeters,
      recordedAt,
    });
  }

  const cumulative = buildCumulativeDistances(routeStops);
  const currentProgress = projectProgressMeters({
    stops: routeStops,
    cumulative,
    currentLat,
    currentLng,
  });
  const expectedStopProgressMeters = cumulative[expectedIndex] ?? 0;

  const hasPassedExpectedStop =
    expectedIndex > 0 &&
    currentProgress.progressMeters >=
      expectedStopProgressMeters + PASSED_STOP_PROGRESS_BUFFER_METERS;

  const stillCloseEnoughToTrustPass =
    expectedDistanceMeters <=
      Math.max(PASSED_STOP_MAX_DIRECT_DISTANCE_METERS, radius * 2.2) &&
    currentProgress.crossTrackDistanceMeters <= Math.max(radius * 1.7, 130);

  if (hasPassedExpectedStop && stillCloseEnoughToTrustPass) {
    return createStopArrival({
      tripId,
      routeId: trip.routeId,
      stop: expectedStop,
      distanceMeters: expectedDistanceMeters,
      recordedAt,
    });
  }

  return null;
}
