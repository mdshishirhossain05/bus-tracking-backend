import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { logStaleAlert } from "./tripEvent.service.js";
import { finalizeTripService } from "./tripLifecycle.service.js";

type MarkStaleTripsResult = {
  checkedCount: number;
  markedCount: number;
  autoEndedCount: number;
  thresholdSeconds: number;
  autoEndTimeoutSeconds: number;
};

export async function markStaleTripsService(
  thresholdSeconds = 60,
): Promise<MarkStaleTripsResult> {
  const staleCutoff = new Date(Date.now() - thresholdSeconds * 1000);
  const autoEndTimeoutSeconds = Number(
    env.TELEMATICS_AUTO_END_TIMEOUT_SECONDS ?? 300,
  );
  const autoEndCutoff = new Date(Date.now() - autoEndTimeoutSeconds * 1000);

  const candidates = await prisma.trip.findMany({
    where: {
      status: "RUNNING",
      lastLocationAt: {
        not: null,
        lt: staleCutoff,
      },
    },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      lastLocationAt: true,
      isStale: true,
    },
  });

  if (candidates.length === 0) {
    return {
      checkedCount: 0,
      markedCount: 0,
      autoEndedCount: 0,
      thresholdSeconds,
      autoEndTimeoutSeconds,
    };
  }

  let markedCount = 0;
  let autoEndedCount = 0;

  for (const trip of candidates) {
    if (!trip.isStale) {
      await prisma.trip.update({
        where: { id: trip.id },
        data: {
          isStale: true,
        },
      });

      await logStaleAlert({
        tripId: trip.id,
        routeId: trip.routeId,
        busId: trip.busId,
        driverId: trip.driverId,
        message: `Trip ${trip.id} has stale live location data.`,
      });

      markedCount += 1;
    }

    if (
      trip.lastLocationAt != null &&
      trip.lastLocationAt.getTime() <= autoEndCutoff.getTime()
    ) {
      const finalized = await finalizeTripService({
        tripId: trip.id,
        endedAt: new Date(),
        endMode: "SYSTEM",
        endReason: "AUTO_TELEMETRY_TIMEOUT",
        endedBySourceType: "SYSTEM",
        actorUserId: null,
        actorRole: null,
        route: null,
        method: "SYSTEM",
        requestId: null,
        ip: null,
        userAgent: "trip-stale-job",
        metaJson: {
          trigger: "stale_job_timeout",
          thresholdSeconds,
          autoEndTimeoutSeconds,
          lastLocationAt: trip.lastLocationAt.toISOString(),
        },
      });

      if (finalized.finalized) {
        autoEndedCount += 1;
      }
    }
  }

  return {
    checkedCount: candidates.length,
    markedCount,
    autoEndedCount,
    thresholdSeconds,
    autoEndTimeoutSeconds,
  };
}
