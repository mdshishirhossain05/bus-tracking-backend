import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { openPreTripWindowsService } from "./preTripWindow.service.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startPreTripWindowJob() {
  const enabled = String(env.ENABLE_PRE_TRIP_WINDOW_JOB ?? "true") === "true";
  if (!enabled) {
    logger.info("Pre-trip window job is disabled");
    return;
  }

  const intervalMs = Number(env.PRE_TRIP_WINDOW_JOB_INTERVAL_MS ?? 30_000);

  if (timer) {
    logger.warn("Pre-trip window job already started");
    return;
  }

  timer = setInterval(async () => {
    if (running) return;

    try {
      running = true;
      const result = await openPreTripWindowsService();
      if (result.openedCount > 0 || result.cancelledStaleCount > 0) {
        logger.info(result, "pre-trip window job processed");
      }
    } catch (error) {
      logger.error({ error }, "pre-trip window job failed");
    } finally {
      running = false;
    }
  }, intervalMs);

  logger.info({ intervalMs }, "Pre-trip window job started");
}

export function stopPreTripWindowJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("Pre-trip window job stopped");
  }
}
