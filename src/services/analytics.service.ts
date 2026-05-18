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

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getAnalyticsOverviewService() {
  const now = new Date();
  const last7 = new Date(now.getTime() - 7 * DAY_MS);
  const last30 = new Date(now.getTime() - 30 * DAY_MS);
  const last14 = new Date(now.getTime() - 14 * DAY_MS);

  const [
    statusGroups,
    totalTrips,
    createdLast7,
    createdLast30,
    topRouteGroups,
    recentTrips,
    arrivalTotal,
    arrivalNoSchedule,
    arrivalLate,
  ] = await Promise.all([
    prisma.trip.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.trip.count(),
    prisma.trip.count({ where: { createdAt: { gte: last7 } } }),
    prisma.trip.count({ where: { createdAt: { gte: last30 } } }),
    prisma.trip.groupBy({
      by: ["routeId"],
      _count: { _all: true },
      orderBy: { _count: { routeId: "desc" } },
      take: 6,
    }),
    prisma.trip.findMany({
      where: { createdAt: { gte: last14 } },
      select: { createdAt: true },
    }),
    prisma.stopArrival.count(),
    prisma.stopArrival.count({ where: { scheduledTime: null } }),
    prisma.stopArrival.count({
      where: { scheduledTime: { not: null }, delayMinutes: { gt: 2 } },
    }),
  ]);

  const statusCount = (status: string) =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0;

  const routeIds = topRouteGroups.map((group) => group.routeId);
  const routes = routeIds.length
    ? await prisma.route.findMany({
        where: { id: { in: routeIds } },
        select: { id: true, routeName: true },
      })
    : [];
  const routeNameById = new Map(routes.map((r) => [r.id, r.routeName]));

  // Bucket the last 14 days of trip creations into a daily series.
  const buckets = new Map<string, number>();
  for (let offset = 13; offset >= 0; offset -= 1) {
    const key = new Date(now.getTime() - offset * DAY_MS)
      .toISOString()
      .slice(0, 10);
    buckets.set(key, 0);
  }
  for (const trip of recentTrips) {
    const key = trip.createdAt.toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const scheduledArrivals = Math.max(0, arrivalTotal - arrivalNoSchedule);
  const onTimeArrivals = Math.max(0, scheduledArrivals - arrivalLate);

  return {
    trips: {
      total: totalTrips,
      running: statusCount("RUNNING"),
      planned: statusCount("PLANNED"),
      ended: statusCount("ENDED"),
      createdLast7Days: createdLast7,
      createdLast30Days: createdLast30,
    },
    arrivals: {
      total: arrivalTotal,
      onTime: onTimeArrivals,
      late: arrivalLate,
      onTimePercentage:
        scheduledArrivals > 0
          ? Math.round((onTimeArrivals / scheduledArrivals) * 1000) / 10
          : 0,
    },
    topRoutes: topRouteGroups.map((group) => ({
      routeId: group.routeId,
      routeName: routeNameById.get(group.routeId) ?? "Unknown route",
      tripCount: group._count._all,
    })),
    dailyTrips: [...buckets.entries()].map(([date, count]) => ({
      date,
      count,
    })),
  };
}
