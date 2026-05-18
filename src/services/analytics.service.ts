import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import type { DelayReportQuery } from "../validators/analytics.validators.js";

/** Arrivals within ±this many minutes of schedule count as on-time. */
const ON_TIME_THRESHOLD_MIN = 2;

export type ArrivalDelayStatus = "ON_TIME" | "LATE" | "EARLY" | "NO_SCHEDULE";

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function deriveStatus(
  scheduledTime: Date | null,
  delayMinutes: number,
): ArrivalDelayStatus {
  if (!scheduledTime) return "NO_SCHEDULE";
  if (delayMinutes > ON_TIME_THRESHOLD_MIN) return "LATE";
  if (delayMinutes < -ON_TIME_THRESHOLD_MIN) return "EARLY";
  return "ON_TIME";
}

function buildArrivalWhere(
  query: DelayReportQuery,
): Prisma.StopArrivalWhereInput {
  const where: Prisma.StopArrivalWhereInput = {};

  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from || to) {
    const actualArrivalTime: Prisma.DateTimeFilter = {};
    if (from) actualArrivalTime.gte = from;
    if (to) actualArrivalTime.lte = to;
    where.actualArrivalTime = actualArrivalTime;
  }

  if (query.routeId) {
    where.trip = { routeId: query.routeId };
  }

  return where;
}

export async function getDelayReportService(query: DelayReportQuery) {
  const { page, limit } = query;
  const skip = (page - 1) * limit;
  const where = buildArrivalWhere(query);
  const scheduledWhere: Prisma.StopArrivalWhereInput = {
    ...where,
    scheduledTime: { not: null },
  };

  const [total, noSchedule, late, early, delayAgg, rows] = await Promise.all([
    prisma.stopArrival.count({ where }),
    prisma.stopArrival.count({
      where: { ...where, scheduledTime: null },
    }),
    prisma.stopArrival.count({
      where: { ...scheduledWhere, delayMinutes: { gt: ON_TIME_THRESHOLD_MIN } },
    }),
    prisma.stopArrival.count({
      where: { ...scheduledWhere, delayMinutes: { lt: -ON_TIME_THRESHOLD_MIN } },
    }),
    prisma.stopArrival.aggregate({
      where: scheduledWhere,
      _avg: { delayMinutes: true },
    }),
    prisma.stopArrival.findMany({
      where,
      skip,
      take: limit,
      orderBy: { actualArrivalTime: "desc" },
      include: {
        trip: { select: { id: true, route: { select: { routeName: true } } } },
        stop: { select: { stopName: true } },
      },
    }),
  ]);

  const scheduled = Math.max(0, total - noSchedule);
  const onTime = Math.max(0, scheduled - late - early);
  const averageDelayMinutes =
    delayAgg._avg.delayMinutes != null
      ? Math.round(delayAgg._avg.delayMinutes * 10) / 10
      : null;

  return {
    summary: {
      totalArrivals: total,
      onTime,
      late,
      early,
      noSchedule,
      averageDelayMinutes,
      latePercentage:
        scheduled > 0 ? Math.round((late / scheduled) * 1000) / 10 : 0,
      onTimePercentage:
        scheduled > 0 ? Math.round((onTime / scheduled) * 1000) / 10 : 0,
    },
    items: rows.map((row) => ({
      id: row.id,
      tripId: row.tripId,
      routeName: row.trip?.route?.routeName ?? null,
      stopName: row.stop?.stopName ?? null,
      scheduledTime: row.scheduledTime
        ? row.scheduledTime.toISOString()
        : null,
      actualArrivalTime: row.actualArrivalTime.toISOString(),
      delayMinutes: row.delayMinutes,
      status: deriveStatus(row.scheduledTime, row.delayMinutes),
    })),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
