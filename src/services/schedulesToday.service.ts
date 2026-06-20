import type { ServiceDayType } from "@prisma/client";
import { prisma } from "../config/prisma.js";

/**
 * Today's / tomorrow's / all schedules for a passenger, sorted by departureTime.
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
 *
 * `departureAtIso` is the UTC instant of the *relevant occurrence* of
 * the departure for this scope:
 *   - "today":    today at HH:MM Dhaka
 *   - "tomorrow": tomorrow at HH:MM Dhaka
 *   - "all":      the next future occurrence of this dayType + HH:MM
 *                 from now, so countdown logic stays meaningful across
 *                 the week.
 */

export type ScheduleScope = "today" | "tomorrow" | "all";

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
  /** UTC instant for the relevant occurrence (see file header). */
  departureAtIso: string;
  /** Day-of-week the schedule runs on. */
  dayType: ServiceDayType;
  notes: string | null;
  isFavorite: boolean;
  trip: ScheduleTodayTripState | null;
};

const DHAKA_OFFSET_MIN = 6 * 60;

const DAY_TYPE_BY_INDEX = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const satisfies ReadonlyArray<ServiceDayType>;

const INDEX_BY_DAY_TYPE: Record<ServiceDayType, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

function formatTimeHHMMSS(value: Date): string {
  const hh = String(value.getUTCHours()).padStart(2, "0");
  const mm = String(value.getUTCMinutes()).padStart(2, "0");
  const ss = String(value.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * UTC instant for an admin-entered Dhaka clock time on a specific
 * Dhaka calendar day (expressed by the Date returned from `dhakaDate`).
 */
function combineLocalDeparture(
  dhakaCalendarDay: { y: number; m: number; d: number },
  departureTime: Date,
): Date {
  const hh = departureTime.getUTCHours();
  const mm = departureTime.getUTCMinutes();
  const ss = departureTime.getUTCSeconds();
  return new Date(
    Date.UTC(
      dhakaCalendarDay.y,
      dhakaCalendarDay.m,
      dhakaCalendarDay.d,
      hh,
      mm,
      ss,
    ) - DHAKA_OFFSET_MIN * 60_000,
  );
}

/** Dhaka calendar day (year / month / date) for a given UTC instant. */
function dhakaCalendar(now: Date): {
  y: number;
  m: number;
  d: number;
  dayIndex: number;
} {
  const dhakaNow = new Date(now.getTime() + DHAKA_OFFSET_MIN * 60_000);
  return {
    y: dhakaNow.getUTCFullYear(),
    m: dhakaNow.getUTCMonth(),
    d: dhakaNow.getUTCDate(),
    dayIndex: dhakaNow.getUTCDay(),
  };
}

/** Shift a Dhaka calendar day by N days, returning a new {y, m, d}. */
function shiftDhakaDay(
  cal: { y: number; m: number; d: number },
  deltaDays: number,
): { y: number; m: number; d: number } {
  const t = Date.UTC(cal.y, cal.m, cal.d) + deltaDays * 86_400_000;
  const shifted = new Date(t);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
  };
}

/**
 * For the "all" scope: find the next future Dhaka calendar day whose
 * weekday matches `dayType` AND whose departure time hasn't already
 * passed in Dhaka. Today counts if HH:MM is still ahead of now.
 */
function nextOccurrenceFromNow(
  now: Date,
  dayType: ServiceDayType,
  departureTime: Date,
): Date {
  const targetIdx = INDEX_BY_DAY_TYPE[dayType];
  const today = dhakaCalendar(now);
  let deltaDays = (targetIdx - today.dayIndex + 7) % 7;
  const candidate = combineLocalDeparture(
    shiftDhakaDay(today, deltaDays),
    departureTime,
  );
  // If today is the matching day but the time has already passed in
  // Dhaka, jump to the same weekday next week.
  if (deltaDays === 0 && candidate.getTime() <= now.getTime()) {
    deltaDays = 7;
  }
  return combineLocalDeparture(
    shiftDhakaDay(today, deltaDays),
    departureTime,
  );
}

export async function listTodaysSchedulesService(
  userId: string,
  scope: ScheduleScope = "today",
): Promise<ScheduleTodayItem[]> {
  const now = new Date();
  const today = dhakaCalendar(now);
  const todayDayType = DAY_TYPE_BY_INDEX[today.dayIndex];
  const tomorrowCal = shiftDhakaDay(today, 1);
  const tomorrowDayType = DAY_TYPE_BY_INDEX[(today.dayIndex + 1) % 7];

  // Trip lookup is meaningful only for "today" — tomorrow / all don't
  // have running trips. We always include it in the query (so Prisma
  // type inference stays clean) and then ignore the result for non-today
  // scopes — `take: 1` keeps the join cheap.
  const targetDayType =
    scope === "today" ? todayDayType : scope === "tomorrow" ? tomorrowDayType : null;

  // Start of today in Dhaka, expressed as UTC, for the trip window.
  const startOfToday = new Date(
    Date.UTC(today.y, today.m, today.d) - DHAKA_OFFSET_MIN * 60_000,
  );

  const [schedules, favorites] = await Promise.all([
    prisma.serviceSchedule.findMany({
      where: {
        ...(targetDayType ? { dayType: targetDayType } : {}),
        isActive: true,
        route: { isActive: true },
        bus: { isActive: true },
      },
      include: {
        route: { select: { id: true, routeName: true } },
        bus: { select: { id: true, busCode: true } },
        driver: { select: { id: true, fullName: true } },
        trips: {
          where: { createdAt: { gte: startOfToday } },
          orderBy: { createdAt: "desc" as const },
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
    // Only show trip state on the "today" scope — tomorrow / all are
    // forward-looking views where the live trip cell would be noise.
    const trip = scope === "today" ? (s.trips[0] ?? null) : null;

    const departureAtIso = (() => {
      if (scope === "today") {
        return combineLocalDeparture(today, s.departureTime).toISOString();
      }
      if (scope === "tomorrow") {
        return combineLocalDeparture(
          tomorrowCal,
          s.departureTime,
        ).toISOString();
      }
      return nextOccurrenceFromNow(
        now,
        s.dayType,
        s.departureTime,
      ).toISOString();
    })();

    return {
      scheduleId: s.id,
      routeId: s.routeId,
      routeName: s.route.routeName,
      busId: s.busId,
      busLabel: s.bus.busCode,
      driverId: s.driver?.id ?? null,
      driverName: s.driver?.fullName ?? null,
      departureTime: formatTimeHHMMSS(s.departureTime),
      departureAtIso,
      dayType: s.dayType,
      notes: s.notes,
      isFavorite: favoriteRouteIds.has(s.routeId),
      trip: trip
        ? {
            id: trip.id,
            status: trip.status,
            preTripPhase: trip.preTripPhase ?? null,
            startedAt: trip.startTime?.toISOString() ?? null,
            endedAt: trip.endTime?.toISOString() ?? null,
            lastEtaMinutes: trip.lastEtaMinutes ?? null,
            nextStopName: trip.nextStopName ?? null,
          }
        : null,
    };
  });
}
