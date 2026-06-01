import { prisma } from "../config/prisma.js";
import { getDayTypeForDate } from "../utils/dayType.js";

/**
 * Today's schedules for a passenger, sorted by departureTime.
 *
 * Joins each schedule with:
 *   - its active route, bus, optional driver (basic display fields)
 *   - the user's favorite flag (so the UI can pin favourites + render
 *     a filled star)
 *   - the corresponding Trip row for *today* (if one exists) so the UI
 *     can show RUNNING / PRE_TRIP / ENDED state and link straight to
 *     live tracking when applicable.
 *
 * `departureTime` comes back as the raw HH:mm:ss string (Dhaka local —
 * same convention the admin enters in the form). The UI then localizes
 * digits and renders a 12-hour clock as needed.
 */

export type ScheduleTodayTripState = {
  id: string;
  status: "PLANNED" | "PRE_TRIP" | "RUNNING" | "ENDED";
  preTripPhase: "AT_DEPOT" | "APPROACHING_ORIGIN" | "AT_ORIGIN" | null;
  startedAt: string | null;
  endedAt: string | null;
  lastEtaMinutes: number | null;
  nextStopName: string | null;
};

export type ScheduleTodayItem = {
  scheduleId: string;
  routeId: string;
  routeName: string;
  busId: string;
  busLabel: string;
  driverId: string | null;
  driverName: string | null;
  /** HH:mm:ss in Dhaka local time. */
  departureTime: string;
  /** Same time, expressed as the UTC instant of today's departure. */
  departureAtIso: string;
  notes: string | null;
  isFavorite: boolean;
  trip: ScheduleTodayTripState | null;
};

const DHAKA_OFFSET_MIN = 6 * 60;

function formatTimeHHMMSS(value: Date): string {
  const hh = String(value.getUTCHours()).padStart(2, "0");
  const mm = String(value.getUTCMinutes()).padStart(2, "0");
  const ss = String(value.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Build today's UTC instant for an admin-entered Dhaka clock time. */
function combineTodayLocalDeparture(now: Date, departureTime: Date): Date {
  const dhakaNow = new Date(now.getTime() + DHAKA_OFFSET_MIN * 60_000);
  const y = dhakaNow.getUTCFullYear();
  const m = dhakaNow.getUTCMonth();
  const d = dhakaNow.getUTCDate();
  const hh = departureTime.getUTCHours();
  const mm = departureTime.getUTCMinutes();
  const ss = departureTime.getUTCSeconds();
  return new Date(Date.UTC(y, m, d, hh, mm, ss) - DHAKA_OFFSET_MIN * 60_000);
}

export async function listTodaysSchedulesService(
  userId: string,
): Promise<ScheduleTodayItem[]> {
  const now = new Date();
  const dayType = getDayTypeForDate(now);

  // Today's window for matching scheduled trips. Schedules created today
  // will surface here; trips created within the last ~24 h are "today".
  const dhakaNow = new Date(now.getTime() + DHAKA_OFFSET_MIN * 60_000);
  const startOfDay = new Date(
    Date.UTC(
      dhakaNow.getUTCFullYear(),
      dhakaNow.getUTCMonth(),
      dhakaNow.getUTCDate(),
    ) - DHAKA_OFFSET_MIN * 60_000,
  );

  const [schedules, favorites] = await Promise.all([
    prisma.serviceSchedule.findMany({
      where: {
        dayType,
        isActive: true,
        route: { isActive: true },
        bus: { isActive: true },
      },
      include: {
        route: { select: { id: true, routeName: true } },
        bus: { select: { id: true, busCode: true } },
        driver: { select: { id: true, fullName: true } },
        trips: {
          where: { createdAt: { gte: startOfDay } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            preTripPhase: true,
            startTime: true,
            endTime: true,
            lastEtaMinutes: true,
            nextStopName: true,
          },
        },
      },
      orderBy: [{ departureTime: "asc" }, { createdAt: "asc" }],
    }),
    prisma.favoriteRoute.findMany({
      where: { userId },
      select: { routeId: true },
    }),
  ]);

  const favoriteRouteIds = new Set(favorites.map((f) => f.routeId));

  return schedules.map((s) => {
    const trip = s.trips[0] ?? null;
    return {
      scheduleId: s.id,
      routeId: s.routeId,
      routeName: s.route.routeName,
      busId: s.busId,
      busLabel: s.bus.busCode,
      driverId: s.driver?.id ?? null,
      driverName: s.driver?.fullName ?? null,
      departureTime: formatTimeHHMMSS(s.departureTime),
      departureAtIso: combineTodayLocalDeparture(
        now,
        s.departureTime,
      ).toISOString(),
      notes: s.notes,
      isFavorite: favoriteRouteIds.has(s.routeId),
      trip: trip
        ? {
            id: trip.id,
            status: trip.status as ScheduleTodayTripState["status"],
            preTripPhase:
              (trip.preTripPhase as ScheduleTodayTripState["preTripPhase"]) ??
              null,
            startedAt: trip.startTime?.toISOString() ?? null,
            endedAt: trip.endTime?.toISOString() ?? null,
            lastEtaMinutes: trip.lastEtaMinutes ?? null,
            nextStopName: trip.nextStopName ?? null,
          }
        : null,
    };
  });
}
