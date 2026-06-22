import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getDayTypeForDate } from "../utils/dayType.js";
import { emitTripPreTripOpened } from "../sockets/tripRealtime.js";
import { createPreTripNotificationsService } from "./notification.service.js";

/**
 * Pre-trip window opener.
 *
 * For each active service schedule today, if we are within the configured
 * "before departure" window (defaults to 60 min), and the driver/bus does
 * not already have a PRE_TRIP or RUNNING trip, we create a Trip row in
 * PRE_TRIP status with phase = AT_DEPOT. This makes the bus track-able by
 * passengers and tells the driver app to start broadcasting location early.
 *
 * Time math: `schedule.departureTime` is a Time-of-day column representing
 * the LOCAL departure time (Dhaka, UTC+6) that an admin entered. Prisma
 * surfaces it as a Date with the local hh:mm:ss encoded as UTC. To compare
 * apples-to-apples we shift `now` by the Dhaka offset before extracting
 * seconds-since-midnight. Without this shift a 4:30 PM Dhaka schedule
 * only opens at 9:30 PM Dhaka — exactly the bug the user hit.
 */

const DEFAULT_BEFORE_MINUTES = 60;
const DEFAULT_AFTER_MINUTES = 5;
const DHAKA_OFFSET_MIN = 6 * 60;

function secondsSinceMidnight(date: Date) {
  return (
    date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()
  );
}

/** "Now" expressed as seconds-since-midnight in Dhaka local time. */
function nowDhakaSeconds(now: Date) {
  const dhakaMs = now.getTime() + DHAKA_OFFSET_MIN * 60_000;
  return secondsSinceMidnight(new Date(dhakaMs));
}

export async function openPreTripWindowsService(): Promise<{
  checkedCount: number;
  openedCount: number;
  cancelledStaleCount: number;
}> {
  const now = new Date();
  const dayType = getDayTypeForDate(now);
  const nowSec = nowDhakaSeconds(now);

  const beforeMin = Number(
    env.PRE_TRIP_WINDOW_BEFORE_MINUTES ?? DEFAULT_BEFORE_MINUTES,
  );
  const afterMin = Number(
    env.PRE_TRIP_WINDOW_AFTER_MINUTES ?? DEFAULT_AFTER_MINUTES,
  );
  const cancelAfterMin = Number(
    env.PRE_TRIP_AUTO_CANCEL_AFTER_MINUTES ?? 240,
  );
  const beforeSec = beforeMin * 60;
  const afterSec = afterMin * 60;

  // Clean up no-show PRE_TRIP trips so a stale row doesn't block today's
  // window opening for the same driver/bus, and passengers don't keep
  // seeing "Bus at depot" forever for an abandoned schedule.
  const cancelCutoff = new Date(now.getTime() - cancelAfterMin * 60_000);
  const cancelled = await prisma.trip.updateMany({
    where: {
      status: "PRE_TRIP",
      preTripStartedAt: { lt: cancelCutoff },
    },
    data: {
      status: "ENDED",
      endTime: now,
      preTripPhase: null,
      originArrivedAt: null,
    },
  });

  const schedules = await prisma.serviceSchedule.findMany({
    where: {
      dayType,
      isActive: true,
      route: { isActive: true },
      bus: { isActive: true },
    },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      departureTime: true,
    },
  });

  let openedCount = 0;

  for (const schedule of schedules) {
    const depSec = secondsSinceMidnight(schedule.departureTime);

    const windowStartSec = depSec - beforeSec;
    const windowEndSec = depSec + afterSec;

    if (nowSec < windowStartSec || nowSec >= windowEndSec) continue;

    const driverOrBusBusy = await prisma.trip.findFirst({
      where: {
        OR: [
          ...(schedule.driverId ? [{ driverId: schedule.driverId }] : []),
          { busId: schedule.busId },
        ],
        status: { in: ["PRE_TRIP", "RUNNING"] },
      },
      select: { id: true, status: true },
    });

    if (driverOrBusBusy) continue;

    const sourceType =
      schedule.driverId == null ? ("GPS_DEVICE" as const) : null;

    try {
      const trip = await prisma.trip.create({
        data: {
          driverId: schedule.driverId,
          routeId: schedule.routeId,
          busId: schedule.busId,
          serviceScheduleId: schedule.id,
          status: "PRE_TRIP",
          preTripPhase: "AT_DEPOT",
          preTripStartedAt: now,
          activationMode: "MANUAL_DRIVER",
          isStale: false,
          preferredTrackingSourceType: sourceType,
        },
        select: {
          id: true,
          routeId: true,
          busId: true,
          driverId: true,
          serviceScheduleId: true,
          preTripPhase: true,
          preTripStartedAt: true,
        },
      });

      openedCount += 1;

      emitTripPreTripOpened({
        tripId: trip.id,
        routeId: trip.routeId,
        busId: trip.busId,
        driverId: trip.driverId,
        serviceScheduleId: trip.serviceScheduleId ?? null,
        preTripPhase: trip.preTripPhase ?? "AT_DEPOT",
        preTripStartedAt: (trip.preTripStartedAt ?? now).toISOString(),
        scheduledDepartureAt: schedule.departureTime.toISOString(),
      });

      // Fan out a "Bus warming up" push to riders who favorited the route
      // or subscribed to a stop. Best-effort, deduped per trip, must never
      // block the realtime broadcast above.
      void createPreTripNotificationsService({
        tripId: trip.id,
        routeId: trip.routeId,
      }).catch(() => undefined);

      logger.info(
        {
          tripId: trip.id,
          scheduleId: schedule.id,
          routeId: trip.routeId,
          busId: trip.busId,
          driverId: trip.driverId,
        },
        "pre-trip window opened",
      );
    } catch (err) {
      logger.error(
        { err, scheduleId: schedule.id },
        "failed to open pre-trip window for schedule",
      );
    }
  }

  return {
    checkedCount: schedules.length,
    openedCount,
    cancelledStaleCount: cancelled.count,
  };
}
