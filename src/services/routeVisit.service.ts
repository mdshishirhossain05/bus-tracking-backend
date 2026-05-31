import { prisma } from "../config/prisma.js";

const MIN_VISIT_SECONDS = 60;

export type VisitRecord = {
  id: string;
  routeId: string;
  routeName: string;
  tripId: string | null;
  visitedAt: string;
  durationSeconds: number | null;
};

export type VisitStats = {
  visitCount30Days: number;
  uniqueRoutes30Days: number;
  totalMinutesTracked: number;
  longestStreakDays: number;
  topRoutes: { routeId: string; routeName: string; count: number }[];
};

/**
 * Start a passenger visit. Returns the visit id so the caller can end it
 * later; visits whose duration is below the floor are pruned at end time
 * so transient "I opened the screen for 2 seconds" interactions don't
 * pollute history.
 */
export async function startRouteVisitService(params: {
  userId: string;
  routeId: string;
  tripId?: string | null;
}): Promise<{ visitId: string }> {
  const visit = await prisma.routeVisit.create({
    data: {
      userId: params.userId,
      routeId: params.routeId,
      tripId: params.tripId ?? null,
    },
    select: { id: true },
  });
  return { visitId: visit.id };
}

export async function endRouteVisitService(params: {
  userId: string;
  visitId: string;
}): Promise<{ ended: boolean; durationSeconds: number | null }> {
  const visit = await prisma.routeVisit.findUnique({
    where: { id: params.visitId },
    select: { id: true, userId: true, visitedAt: true, endedAt: true },
  });
  if (!visit || visit.userId !== params.userId) {
    return { ended: false, durationSeconds: null };
  }
  if (visit.endedAt) {
    return { ended: false, durationSeconds: null };
  }
  const endedAt = new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - visit.visitedAt.getTime()) / 1000),
  );
  if (durationSeconds < MIN_VISIT_SECONDS) {
    await prisma.routeVisit.delete({ where: { id: visit.id } });
    return { ended: true, durationSeconds };
  }
  await prisma.routeVisit.update({
    where: { id: visit.id },
    data: { endedAt, durationSeconds },
  });
  return { ended: true, durationSeconds };
}

export async function listVisitHistoryService(
  userId: string,
  limit = 50,
): Promise<VisitRecord[]> {
  const rows = await prisma.routeVisit.findMany({
    where: { userId, endedAt: { not: null } },
    orderBy: { visitedAt: "desc" },
    take: limit,
    include: { route: { select: { routeName: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    routeId: row.routeId,
    routeName: row.route.routeName,
    tripId: row.tripId,
    visitedAt: row.visitedAt.toISOString(),
    durationSeconds: row.durationSeconds,
  }));
}

export async function getVisitStatsService(
  userId: string,
): Promise<VisitStats> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const recent = await prisma.routeVisit.findMany({
    where: {
      userId,
      endedAt: { not: null },
      visitedAt: { gte: since },
    },
    select: {
      routeId: true,
      durationSeconds: true,
      visitedAt: true,
      route: { select: { routeName: true } },
    },
  });

  const visitCount30Days = recent.length;
  const uniqueRoutes30Days = new Set(recent.map((r) => r.routeId)).size;
  const totalMinutesTracked = Math.round(
    recent.reduce((acc, r) => acc + (r.durationSeconds ?? 0), 0) / 60,
  );

  // Streak: consecutive days (in Dhaka local) ending today on which the
  // user had at least one visit.
  const DHAKA_OFFSET_MIN = 6 * 60;
  const daySet = new Set<string>();
  for (const r of recent) {
    const local = new Date(
      r.visitedAt.getTime() + DHAKA_OFFSET_MIN * 60_000,
    );
    daySet.add(
      `${local.getUTCFullYear()}-${local.getUTCMonth()}-${local.getUTCDate()}`,
    );
  }

  let longestStreakDays = 0;
  let cursor = new Date(Date.now() + DHAKA_OFFSET_MIN * 60_000);
  for (let i = 0; i < 60; i += 1) {
    const key = `${cursor.getUTCFullYear()}-${cursor.getUTCMonth()}-${cursor.getUTCDate()}`;
    if (daySet.has(key)) {
      longestStreakDays += 1;
    } else if (i > 0) {
      break;
    }
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  const counts = new Map<string, { routeName: string; count: number }>();
  for (const r of recent) {
    const prev = counts.get(r.routeId);
    counts.set(r.routeId, {
      routeName: r.route.routeName,
      count: (prev?.count ?? 0) + 1,
    });
  }
  const topRoutes = Array.from(counts.entries())
    .map(([routeId, v]) => ({ routeId, routeName: v.routeName, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    visitCount30Days,
    uniqueRoutes30Days,
    totalMinutesTracked,
    longestStreakDays,
    topRoutes,
  };
}
