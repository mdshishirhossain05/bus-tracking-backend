import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getDayTypeForDate } from "../utils/dayType.js";
import { emitTripPreTripOpened } from "../sockets/tripRealtime.js";

/**
 * Pre-trip window opener.
 *
 * For each active service schedule today, if we are within the configured
 * "before departure" window (defaults to 60 min), and the driver/bus does
 * not already have a PRE_TRIP or RUNNING trip, we create a Trip row in
 * PRE_TRIP status with phase = AT_DEPOT. This makes the bus track-able by
 * passengers and tells the driver app to start broadcasting location early.
 *
 * Time math mirrors the existing telematics auto-start logic
 * (UTC-based secondsSinceMidnight): consistent assumption across the
 * codebase that schedule.departureTime is a Time column whose UTC
 * representation matches "now"s UTC representation.
 */

const DEFAULT_BEFORE_MINUTES = 60;
const DEFAULT_AFTER_MINUTES = 5;

function secondsSinceMidnight(date: Date) {
  return (
    date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()
  );
}

export async function openPreTripWindowsService(): Promise<{
  checkedCount: number;
  openedCount: number;
  cancelledStaleCount: number;
}> {
  const now = new Date();
  const dayType = getDayTypeForDate(now);
  const nowSec = secondsSinceMidnight(now);

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
