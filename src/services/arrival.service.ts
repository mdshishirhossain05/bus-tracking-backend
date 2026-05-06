import { prisma } from "../config/prisma.js";
import { haversineMeters, toNumber } from "../utils/geo.js";
import { getDayTypeForDate } from "../utils/dayType.js";
import { env } from "../config/env.js";

const DHAKA_OFFSET_MIN = 6 * 60; // UTC+6 (Asia/Dhaka)

function buildScheduledDateDhaka(actualUtc: Date, scheduledTime: Date) {
  // scheduledTime is time-only stored as a Date-like object.
  // We interpret its UTC hours/min/sec as the intended CLOCK time in Dhaka.
  const hh = scheduledTime.getUTCHours();
  const mm = scheduledTime.getUTCMinutes();
  const ss = scheduledTime.getUTCSeconds();

  // Convert actual UTC time to "Dhaka-local date" by shifting +6h,
  // then read Y/M/D from UTC getters (so date parts are stable)
  const dhakaMs = actualUtc.getTime() + DHAKA_OFFSET_MIN * 60_000;
  const dhaka = new Date(dhakaMs);

  const y = dhaka.getUTCFullYear();
  const m = dhaka.getUTCMonth();
  const d = dhaka.getUTCDate();

  // Build scheduled time on that Dhaka date, then convert back to UTC by subtracting 6h
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

  const radius = Number(env.ARRIVAL_RADIUS_METERS ?? 80);

  // ✅ Choose NEAREST stop within radius
  let candidate: {
    rs: (typeof trip.route.routeStops)[number];
    d: number;
  } | null = null;

  for (const rs of trip.route.routeStops) {
    const dist = haversineMeters(
      currentLat,
      currentLng,
      toNumber(rs.stop.lat),
      toNumber(rs.stop.lng),
    );

    if (dist <= radius) {
      if (!candidate || dist < candidate.d) candidate = { rs, d: dist };
    }
  }

  if (!candidate) return null;

  const { rs, d } = candidate;

  // Already recorded?
  const existing = await prisma.stopArrival.findUnique({
    where: { tripId_stopId: { tripId, stopId: rs.stop.id } },
  });
  if (existing) return null;

  // ✅ Find schedule for this route+stop+dayType
  const dayType = getDayTypeForDate(recordedAt);

  const schedules = await prisma.schedule.findMany({
    where: {
      routeId: trip.routeId,
      stopId: rs.stop.id,
      dayType,
    },
    orderBy: { scheduledTime: "asc" },
  });

  // Choose schedule time closest to actual arrival
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

  // ✅ FIX: Never pass scheduledTime: undefined (exactOptionalPropertyTypes)
  const createData: {
    tripId: string;
    stopId: string;
    actualArrivalTime: Date;
    delayMinutes: number;
    scheduledTime?: Date; // only added when exists
  } = {
    tripId,
    stopId: rs.stop.id,
    actualArrivalTime: recordedAt,
    delayMinutes,
  };

  if (chosenSchedule) {
    createData.scheduledTime = chosenSchedule.scheduledTime;
  }

  await prisma.stopArrival.create({ data: createData });

  return {
    tripId,
    stopId: rs.stop.id,
    stopName: rs.stop.stopName,
    stopOrder: rs.stopOrder,
    arrivalTime: recordedAt.toISOString(),
    distanceMeters: Math.round(d),
    dayType,

    // ✅ Human-readable schedule time (Dhaka clock time)
    scheduledTime: chosenSchedule
      ? formatTimeHHMMSS(chosenSchedule.scheduledTime)
      : null,

    // ✅ Debug/trace (optional but useful in thesis + testing)
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
