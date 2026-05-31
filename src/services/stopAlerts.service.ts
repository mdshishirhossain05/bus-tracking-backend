import { prisma } from "../config/prisma.js";
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";
import { getIO } from "../sockets/io.js";
import { SOCKET_EVENTS, getUserRoom } from "../sockets/events.js";
import { sendExpoPushToUsersService } from "./pushNotification.service.js";
import { isInQuietHours } from "./notificationPreferences.service.js";
import type { StopEta } from "./eta.service.js";

const DEDUP_TTL_MS = 2 * 60 * 60 * 1000; // 2 h — outlasts any single trip

function dedupKey(tripId: string, stopId: string, userId: string) {
  return `stopAlert:${tripId}:${stopId}:${userId}`;
}

/**
 * Fan out "your bus is X min away from <stop>" pushes to every passenger
 * subscribed to a stop on this route, exactly once per trip+stop+user.
 *
 * Best-effort: a failure here never blocks location ingestion. The dedup
 * happens BEFORE we send, so transient send errors can still leave a key
 * that suppresses a retry — that's acceptable (worst case: the user gets
 * one missed alert on a single trip).
 */
export async function triggerStopApproachAlertsService(params: {
  tripId: string;
  routeId: string;
  stopEtas: StopEta[];
}): Promise<{ fired: number; suppressed: number }> {
  const eligibleStopEtas = params.stopEtas.filter(
    (s) => s.etaMinutes != null && s.etaMinutes >= 0,
  );

  if (eligibleStopEtas.length === 0) {
    return { fired: 0, suppressed: 0 };
  }

  // Find all subscriptions whose stop is on this route, where the bus is
  // at most as far away (in minutes) as the user's chosen lead time.
  // We over-fetch (any stop on the route) and filter in JS — cheaper than
  // a per-stop query when most routes have few stops.
  const subscriptions = await prisma.stopSubscription.findMany({
    where: {
      routeId: params.routeId,
      enabled: true,
      stopId: { in: eligibleStopEtas.map((s) => s.stopId) },
      user: { notificationsEnabled: true },
    },
    select: {
      id: true,
      userId: true,
      stopId: true,
      leadTimeMinutes: true,
      user: {
        select: {
          quietHoursStartMin: true,
          quietHoursEndMin: true,
          notificationsEnabled: true,
        },
      },
    },
  });

  if (subscriptions.length === 0) {
    return { fired: 0, suppressed: 0 };
  }

  // Only look up the route name once, lazily, after we know we have
  // candidates — keeps the no-subscriber hot path to a single query.
  const route = await prisma.route.findUnique({
    where: { id: params.routeId },
    select: { routeName: true },
  });
  const routeName = route?.routeName ?? "your bus";

  const stopEtaById = new Map(
    eligibleStopEtas.map((s) => [s.stopId, s] as const),
  );

  const now = new Date();
  let fired = 0;
  let suppressed = 0;
  const sendQueue: Array<{
    userId: string;
    title: string;
    body: string;
    link: string;
    stopId: string;
    stopName: string;
    etaMinutes: number;
    dedupKey: string;
  }> = [];

  for (const sub of subscriptions) {
    const stopEta = stopEtaById.get(sub.stopId);
    if (!stopEta || stopEta.etaMinutes == null) continue;
    if (stopEta.etaMinutes > sub.leadTimeMinutes) {
      // Bus still too far away for this user's chosen window.
      continue;
    }

    if (
      isInQuietHours(
        {
          notificationsEnabled: sub.user.notificationsEnabled,
          quietHoursStartMin: sub.user.quietHoursStartMin,
          quietHoursEndMin: sub.user.quietHoursEndMin,
        },
        now,
      )
    ) {
      suppressed += 1;
      continue;
    }

    const key = dedupKey(params.tripId, sub.stopId, sub.userId);
    const alreadyFired = await redis.set(key, "1", {
      PX: DEDUP_TTL_MS,
      NX: true,
    });
    if (alreadyFired !== "OK") {
      // Another tick already fired this alert. Don't re-send.
      suppressed += 1;
      continue;
    }

    const etaText =
      stopEta.etaMinutes <= 1
        ? "less than 1 minute"
        : `${stopEta.etaMinutes} minutes`;
    sendQueue.push({
      userId: sub.userId,
      title: `Bus arriving at ${stopEta.stopName}`,
      body: `${routeName} reaches ${stopEta.stopName} in about ${etaText}.`,
      link: "/passenger/live",
      stopId: sub.stopId,
      stopName: stopEta.stopName,
      etaMinutes: stopEta.etaMinutes,
      dedupKey: key,
    });
    fired += 1;
  }

  if (sendQueue.length === 0) {
    return { fired, suppressed };
  }

  // Persist in-app notifications so they show up in the bell list too.
  await prisma.notification
    .createMany({
      data: sendQueue.map((q) => ({
        userId: q.userId,
        type: "STOP_APPROACH",
        title: q.title,
        body: q.body,
        link: q.link,
      })),
    })
    .catch((err) => {
      logger.warn(
        { err, count: sendQueue.length },
        "stop approach: persist notifications failed (non-fatal)",
      );
    });

  // Live nudge to any connected sessions.
  try {
    const io = getIO();
    for (const q of sendQueue) {
      io.to(getUserRoom(q.userId)).emit(SOCKET_EVENTS.NOTIFICATION, {
        type: "STOP_APPROACH",
        stopName: q.stopName,
        etaMinutes: q.etaMinutes,
      });
    }
  } catch {
    // Socket server not ready yet — pushes still deliver.
  }

  // Wake closed/backgrounded devices via Expo push. Each subscription has
  // a different stop name in the body, so we dispatch per-user rather than
  // batching one common payload across recipients.
  await Promise.all(
    sendQueue.map((q) =>
      sendExpoPushToUsersService([q.userId], {
        title: q.title,
        body: q.body,
        data: {
          type: "STOP_APPROACH",
          link: q.link,
          tripId: params.tripId,
          routeId: params.routeId,
          stopId: q.stopId,
          etaMinutes: q.etaMinutes,
        },
      }).catch((err: unknown) => {
        logger.warn(
          { err, userId: q.userId },
          "stop approach: expo push failed (non-fatal)",
        );
      }),
    ),
  );

  return { fired, suppressed };
}
