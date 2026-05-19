import { prisma } from "../config/prisma.js";
import { getIO } from "../sockets/io.js";
import { SOCKET_EVENTS, getUserRoom } from "../sockets/events.js";

const MAX_LIST = 30;

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

  await prisma.notification.createMany({
    data: favorites.map((favorite) => ({
      userId: favorite.userId,
      type: "STOP_ARRIVAL",
      title: `Bus reached ${input.stopName}`,
      body: `A bus on ${routeName} just arrived at ${input.stopName}${delayText}.`,
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
}
