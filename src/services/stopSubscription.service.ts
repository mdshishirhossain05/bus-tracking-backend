import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/appError.js";

export type StopSubscriptionRecord = {
  id: string;
  stopId: string;
  stopName: string;
  routeId: string;
  routeName: string;
  leadTimeMinutes: number;
  enabled: boolean;
  createdAt: string;
};

const MIN_LEAD_TIME = 1;
const MAX_LEAD_TIME = 60;
const DEFAULT_LEAD_TIME = 5;

function clampLeadTime(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LEAD_TIME;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_LEAD_TIME, Math.max(MIN_LEAD_TIME, rounded));
}

export async function listStopSubscriptionsService(
  userId: string,
): Promise<StopSubscriptionRecord[]> {
  const rows = await prisma.stopSubscription.findMany({
    where: { userId },
    include: {
      stop: { select: { stopName: true } },
      route: { select: { routeName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => ({
    id: row.id,
    stopId: row.stopId,
    stopName: row.stop.stopName,
    routeId: row.routeId,
    routeName: row.route.routeName,
    leadTimeMinutes: row.leadTimeMinutes,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function upsertStopSubscriptionService(
  userId: string,
  input: { stopId: string; routeId: string; leadTimeMinutes?: number },
): Promise<StopSubscriptionRecord> {
  const leadTimeMinutes = clampLeadTime(
    input.leadTimeMinutes ?? DEFAULT_LEAD_TIME,
  );

  const routeStop = await prisma.routeStop.findFirst({
    where: { routeId: input.routeId, stopId: input.stopId },
    select: { id: true },
  });
  if (!routeStop) {
    throw new AppError({
      statusCode: 404,
      code: "STOP_NOT_ON_ROUTE",
      message: "That stop is not part of the selected route",
    });
  }

  const row = await prisma.stopSubscription.upsert({
    where: {
      userId_stopId_routeId: {
        userId,
        stopId: input.stopId,
        routeId: input.routeId,
      },
    },
    create: {
      userId,
      stopId: input.stopId,
      routeId: input.routeId,
      leadTimeMinutes,
      enabled: true,
    },
    update: { leadTimeMinutes, enabled: true },
    include: {
      stop: { select: { stopName: true } },
      route: { select: { routeName: true } },
    },
  });

  return {
    id: row.id,
    stopId: row.stopId,
    stopName: row.stop.stopName,
    routeId: row.routeId,
    routeName: row.route.routeName,
    leadTimeMinutes: row.leadTimeMinutes,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function toggleStopSubscriptionService(
  userId: string,
  stopId: string,
  routeId: string,
  enabled: boolean,
): Promise<StopSubscriptionRecord> {
  const updated = await prisma.stopSubscription.update({
    where: { userId_stopId_routeId: { userId, stopId, routeId } },
    data: { enabled },
    include: {
      stop: { select: { stopName: true } },
      route: { select: { routeName: true } },
    },
  });
  return {
    id: updated.id,
    stopId: updated.stopId,
    stopName: updated.stop.stopName,
    routeId: updated.routeId,
    routeName: updated.route.routeName,
    leadTimeMinutes: updated.leadTimeMinutes,
    enabled: updated.enabled,
    createdAt: updated.createdAt.toISOString(),
  };
}

export async function deleteStopSubscriptionService(
  userId: string,
  stopId: string,
  routeId: string,
): Promise<void> {
  await prisma.stopSubscription.deleteMany({
    where: { userId, stopId, routeId },
  });
}
