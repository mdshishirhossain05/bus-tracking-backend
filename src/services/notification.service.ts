import { prisma } from "../config/prisma.js";
import { redis } from "../config/redis.js";
import { getIO } from "../sockets/io.js";
import { SOCKET_EVENTS, getUserRoom } from "../sockets/events.js";
import { sendExpoPushToUsersService } from "./pushNotification.service.js";
import { isInQuietHours } from "./notificationPreferences.service.js";

const MAX_LIST = 30;

// "Bus departed" should fire at most once per trip, regardless of how many
// activation paths (manual driver, admin, auto-telematics promotion) reach
// emitTripStarted. The dedup key outlives any single trip.
const DEPARTURE_DEDUP_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
// Same idea for the pre-trip "warming up" push — once per tripId, no
// matter how many pre-trip events fan in (window opener cron, GPS
// auto-create, etc.).
const PRE_TRIP_DEDUP_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
// And for the cancelled / abnormally-ended trip push.
const CANCELLED_DEDUP_TTL_MS = 6 * 60 * 60 * 1000; // 6 h

export async function listNotificationsService(userId: string) {
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: MAX_LIST,
    }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      isRead: row.isRead,
      createdAt: row.createdAt.toISOString(),
    })),
    unreadCount,
  };
}

export async function markAllNotificationsReadService(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return listNotificationsService(userId);
}

export async function markNotificationReadService(
  userId: string,
  notificationId: string,
) {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
  return listNotificationsService(userId);
}

/**
 * Fan out a stop-arrival notification to every passenger who has favorited
 * the route. Best-effort: failures are swallowed by the caller.
 */
export async function createArrivalNotificationsService(input: {
  routeId: string;
  stopName: string;
  delayMinutes: number;
  status: string;
}) {
  const favorites = await prisma.favoriteRoute.findMany({
    where: { routeId: input.routeId },
    select: { userId: true },
  });

  if (favorites.length === 0) return;

  const route = await prisma.route.findUnique({
    where: { id: input.routeId },
    select: { routeName: true },
  });
  const routeName = route?.routeName ?? "your favorited route";

  const delayText =
    input.status === "LATE"
      ? ` (${input.delayMinutes} min late)`
      : input.status === "EARLY"
        ? ` (${Math.abs(input.delayMinutes)} min early)`
        : input.status === "ON_TIME"
          ? " (on time)"
          : "";

  const title = `Bus reached ${input.stopName}`;
  const body = `A bus on ${routeName} just arrived at ${input.stopName}${delayText}.`;

  await prisma.notification.createMany({
    data: favorites.map((favorite) => ({
      userId: favorite.userId,
      type: "STOP_ARRIVAL",
      title,
      body,
      link: "/passenger/live",
    })),
  });

  // Nudge any connected recipients so their notification panel updates live.
  try {
    const io = getIO();
    for (const favorite of favorites) {
      io.to(getUserRoom(favorite.userId)).emit(SOCKET_EVENTS.NOTIFICATION, {
        type: "STOP_ARRIVAL",
      });
    }
  } catch {
    // Socket server not ready — persisted notifications are still delivered
    // on the next fetch.
  }

  // Wake closed/backgrounded devices via Expo push (best-effort).
  await sendExpoPushToUsersService(
    favorites.map((favorite) => favorite.userId),
    {
      title,
      body,
      data: { type: "STOP_ARRIVAL", link: "/passenger/live", routeId: input.routeId },
    },
  ).catch(() => undefined);
}

/**
 * Fan out a "bus departed" notification when a trip starts, to every
 * passenger who either favorited the route or subscribed to a stop on it.
 * Fires at most once per trip (redis NX dedup), respects each user's
 * notifications-enabled flag and quiet hours, and is best-effort end to end:
 * a failure here never blocks the trip-start broadcast.
 */
export async function createDepartureNotificationsService(input: {
  tripId: string;
  routeId: string;
}) {
  // Once per trip, across every activation path.
  const claimed = await redis
    .set(`tripDeparted:${input.tripId}`, "1", {
      PX: DEPARTURE_DEDUP_TTL_MS,
      NX: true,
    })
    .catch(() => "OK"); // if redis is down, don't suppress the first attempt
  if (claimed !== "OK") return;

  // Recipients = anyone who favorited the route OR subscribed to a stop on it.
  const [favorites, subscriptions] = await Promise.all([
    prisma.favoriteRoute.findMany({
      where: { routeId: input.routeId },
      select: { userId: true },
    }),
    prisma.stopSubscription.findMany({
      where: { routeId: input.routeId, enabled: true },
      select: { userId: true },
    }),
  ]);

  const candidateIds = [
    ...new Set([
      ...favorites.map((f) => f.userId),
      ...subscriptions.map((s) => s.userId),
    ]),
  ];
  if (candidateIds.length === 0) return;

  // Respect the notifications-enabled flag and quiet hours per user.
  const users = await prisma.user.findMany({
    where: { id: { in: candidateIds }, notificationsEnabled: true },
    select: {
      id: true,
      notificationsEnabled: true,
      quietHoursStartMin: true,
      quietHoursEndMin: true,
    },
  });
  const now = new Date();
  const recipients = users
    .filter(
      (u) =>
        !isInQuietHours(
          {
            notificationsEnabled: u.notificationsEnabled,
            quietHoursStartMin: u.quietHoursStartMin,
            quietHoursEndMin: u.quietHoursEndMin,
          },
          now,
        ),
    )
    .map((u) => u.id);
  if (recipients.length === 0) return;

  const route = await prisma.route.findUnique({
    where: { id: input.routeId },
    select: { routeName: true },
  });
  const routeName = route?.routeName ?? "your route";

  const title = `Bus departed · ${routeName}`;
  const body = `A bus on ${routeName} has started its trip. Track it live now.`;

  await prisma.notification
    .createMany({
      data: recipients.map((userId) => ({
        userId,
        type: "TRIP_DEPARTED",
        title,
        body,
        link: "/passenger/live",
      })),
    })
    .catch(() => undefined);

  // Live nudge to connected sessions.
  try {
    const io = getIO();
    for (const userId of recipients) {
      io.to(getUserRoom(userId)).emit(SOCKET_EVENTS.NOTIFICATION, {
        type: "TRIP_DEPARTED",
      });
    }
  } catch {
    // Socket server not ready — persisted notifications still deliver.
  }

  // Wake closed/backgrounded devices via Expo push.
  await sendExpoPushToUsersService(recipients, {
    title,
    body,
    data: {
      type: "TRIP_DEPARTED",
      link: "/passenger/live",
      tripId: input.tripId,
      routeId: input.routeId,
    },
  }).catch(() => undefined);
}

/**
 * Fan out a "Bus warming up" notification when a trip enters PRE_TRIP.
 *
 * Riders who favorited the route get an early heads-up the moment the
 * bus starts broadcasting from the depot — typically ~60 min before
 * scheduled departure — so they can leave for the stop on time, without
 * having to wait for the trip to officially go RUNNING.
 *
 * Same shape as createDepartureNotificationsService: redis NX dedup,
 * respects per-user notificationsEnabled + quiet hours, persists an
 * in-app Notification row, emits a socket nudge to live sessions, and
 * sends an Expo push to wake closed devices. Best-effort end to end —
 * a failure here never blocks the pre-trip broadcast.
 */
export async function createPreTripNotificationsService(input: {
  tripId: string;
  routeId: string;
}) {
  // Once per trip's PRE_TRIP entry, across every code path that might
  // create the row (cron window opener, GPS-driven auto-create, etc.).
  const claimed = await redis
    .set(`tripPreTrip:${input.tripId}`, "1", {
      PX: PRE_TRIP_DEDUP_TTL_MS,
      NX: true,
    })
    .catch(() => "OK"); // redis down → don't suppress the first attempt
  if (claimed !== "OK") return;

  // Recipients = anyone who favorited the route OR subscribed to a stop
  // on it. Matches the trip-departed audience, since interest in the
  // route is the same signal at either lifecycle stage.
  const [favorites, subscriptions] = await Promise.all([
    prisma.favoriteRoute.findMany({
      where: { routeId: input.routeId },
      select: { userId: true },
    }),
    prisma.stopSubscription.findMany({
      where: { routeId: input.routeId, enabled: true },
      select: { userId: true },
    }),
  ]);

  const candidateIds = [
    ...new Set([
      ...favorites.map((f) => f.userId),
      ...subscriptions.map((s) => s.userId),
    ]),
  ];
  if (candidateIds.length === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: candidateIds }, notificationsEnabled: true },
    select: {
      id: true,
      notificationsEnabled: true,
      quietHoursStartMin: true,
      quietHoursEndMin: true,
    },
  });
  const now = new Date();
  const recipients = users
    .filter(
      (u) =>
        !isInQuietHours(
          {
            notificationsEnabled: u.notificationsEnabled,
            quietHoursStartMin: u.quietHoursStartMin,
            quietHoursEndMin: u.quietHoursEndMin,
          },
          now,
        ),
    )
    .map((u) => u.id);
  if (recipients.length === 0) return;

  const route = await prisma.route.findUnique({
    where: { id: input.routeId },
    select: { routeName: true },
  });
  const routeName = route?.routeName ?? "your route";

  const title = `Bus warming up · ${routeName}`;
  const body = `A bus on ${routeName} just started broadcasting from the depot. The trip will begin shortly.`;

  await prisma.notification
    .createMany({
      data: recipients.map((userId) => ({
        userId,
        type: "TRIP_PRE_TRIP",
        title,
        body,
        link: "/passenger/live",
      })),
    })
    .catch(() => undefined);

  try {
    const io = getIO();
    for (const userId of recipients) {
      io.to(getUserRoom(userId)).emit(SOCKET_EVENTS.NOTIFICATION, {
        type: "TRIP_PRE_TRIP",
      });
    }
  } catch {
    // Socket server not ready — persisted notifications still deliver.
  }

  await sendExpoPushToUsersService(recipients, {
    title,
    body,
    data: {
      type: "TRIP_PRE_TRIP",
      link: "/passenger/live",
      tripId: input.tripId,
      routeId: input.routeId,
    },
  }).catch(() => undefined);
}

/**
 * Fan out a "Bus cancelled" notification when a trip ends ABNORMALLY.
 *
 * Riders who favorited the route get told so they stop waiting for a
 * bus that isn’t coming. Only fires for unexpected ends — natural
 * completion (bus reached final stop) is NOT a notification event,
 * since the rider already saw or is finishing the trip themselves.
 *
 * Caller passes the trip end reason; we filter to the abnormal subset:
 *   - MANUAL_ADMIN              (someone above the driver killed it)
 *   - AUTO_TELEMETRY_TIMEOUT    (GPS feed died mid-route)
 *   - SYSTEM_STALE_TIMEOUT      (system gave up on a stuck feed)
 * Other reasons (driver-ended, reached final stop) are treated as
 * legitimate completions and skipped silently.
 *
 * Same shape as createDepartureNotificationsService: redis NX dedup,
 * respects per-user prefs + quiet hours, persists in-app row, socket
 * nudge, Expo push to wake closed devices. Best-effort end to end.
 */
export async function createTripCancelledNotificationsService(input: {
  tripId: string;
  routeId: string;
  endReason:
    | "MANUAL_DRIVER"
    | "MANUAL_ADMIN"
    | "AUTO_FINAL_STOP_ARRIVAL"
    | "AUTO_FINAL_STOP_STATIONARY"
    | "AUTO_TELEMETRY_TIMEOUT"
    | "SYSTEM_STALE_TIMEOUT"
    | string
    | undefined;
}) {
  const reason = input.endReason ?? "";
  const abnormal =
    reason === "MANUAL_ADMIN" ||
    reason === "AUTO_TELEMETRY_TIMEOUT" ||
    reason === "SYSTEM_STALE_TIMEOUT";
  if (!abnormal) return;

  const claimed = await redis
    .set(`tripCancelled:${input.tripId}`, "1", {
      PX: CANCELLED_DEDUP_TTL_MS,
      NX: true,
    })
    .catch(() => "OK");
  if (claimed !== "OK") return;

  const [favorites, subscriptions] = await Promise.all([
    prisma.favoriteRoute.findMany({
      where: { routeId: input.routeId },
      select: { userId: true },
    }),
    prisma.stopSubscription.findMany({
      where: { routeId: input.routeId, enabled: true },
      select: { userId: true },
    }),
  ]);

  const candidateIds = [
    ...new Set([
      ...favorites.map((f) => f.userId),
      ...subscriptions.map((s) => s.userId),
    ]),
  ];
  if (candidateIds.length === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: candidateIds }, notificationsEnabled: true },
    select: {
      id: true,
      notificationsEnabled: true,
      quietHoursStartMin: true,
      quietHoursEndMin: true,
    },
  });
  const now = new Date();
  const recipients = users
    .filter(
      (u) =>
        !isInQuietHours(
          {
            notificationsEnabled: u.notificationsEnabled,
            quietHoursStartMin: u.quietHoursStartMin,
            quietHoursEndMin: u.quietHoursEndMin,
          },
          now,
        ),
    )
    .map((u) => u.id);
  if (recipients.length === 0) return;

  const route = await prisma.route.findUnique({
    where: { id: input.routeId },
    select: { routeName: true },
  });
  const routeName = route?.routeName ?? "your route";

  // Two close reasons get a slightly different body so the rider
  // understands WHY their bus stopped — admin action vs lost feed.
  const lostFeed =
    reason === "AUTO_TELEMETRY_TIMEOUT" || reason === "SYSTEM_STALE_TIMEOUT";
  const title = `Trip cancelled · ${routeName}`;
  const body = lostFeed
    ? `We lost contact with the bus on ${routeName}. The trip has ended.`
    : `The trip on ${routeName} has been cancelled.`;

  await prisma.notification
    .createMany({
      data: recipients.map((userId) => ({
        userId,
        type: "TRIP_CANCELLED",
        title,
        body,
        link: "/passenger/live",
      })),
    })
    .catch(() => undefined);

  try {
    const io = getIO();
    for (const userId of recipients) {
      io.to(getUserRoom(userId)).emit(SOCKET_EVENTS.NOTIFICATION, {
        type: "TRIP_CANCELLED",
      });
    }
  } catch {
    // Socket server not ready — persisted notifications still deliver.
  }

  await sendExpoPushToUsersService(recipients, {
    title,
    body,
    data: {
      type: "TRIP_CANCELLED",
      link: "/passenger/live",
      tripId: input.tripId,
      routeId: input.routeId,
    },
  }).catch(() => undefined);
}
