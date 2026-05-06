import { markStaleTripsService } from "./tripStale.service.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

let staleJobTimer: NodeJS.Timeout | null = null;
let running = false;

export function startTripStaleJob() {
  const enabled = String(env.ENABLE_TRIP_STALE_JOB ?? "true") === "true";
  if (!enabled) {
    logger.info("Trip stale job is disabled");
    return;
  }

  const intervalMs = Number(env.TRIP_STALE_JOB_INTERVAL_MS ?? 30000);
  const thresholdSeconds = Number(env.TRIP_STALE_THRESHOLD_SECONDS ?? 60);

  if (staleJobTimer) {
    logger.warn("Trip stale job already started");
    return;
  }

  staleJobTimer = setInterval(async () => {
    if (running) return;

    try {
      running = true;

      const result = await markStaleTripsService(thresholdSeconds);

      if (result.markedCount > 0) {
        logger.info(
          {
            checkedCount: result.checkedCount,
            markedCount: result.markedCount,
            thresholdSeconds: result.thresholdSeconds,
          },
          "Trip stale job marked stale trips",
        );
      }
    } catch (error) {
      logger.error({ error }, "Trip stale job failed");
    } finally {
      running = false;
    }
  }, intervalMs);

  logger.info(
    {
      intervalMs,
      thresholdSeconds,
    },
    "Trip stale job started",
  );
}

export function stopTripStaleJob() {
  if (staleJobTimer) {
    clearInterval(staleJobTimer);
    staleJobTimer = null;
    logger.info("Trip stale job stopped");
  }
}
