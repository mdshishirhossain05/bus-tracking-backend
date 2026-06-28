import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  fetchTraccarDeviceById,
  fetchTraccarLatestPositionForDevice,
  isTraccarConfigured,
} from "./traccar.service.js";
import { ingestGpsDeviceLocationService } from "./gpsIngest.service.js";

const pollLogger = logger.child({ scope: "traccarPoll" });

let timer: NodeJS.Timeout | null = null;
let cycleRunning = false;

const KNOTS_TO_KMH = 1.852;

async function pollOnce() {
  if (cycleRunning) return;
  cycleRunning = true;

  try {
    if (!isTraccarConfigured()) return;

    // Only Traccar-managed devices that have actually been reconciled with a
    // remote `traccarDeviceId`. Without that ID we have nothing to poll
    // against.
    const devices = await prisma.gpsDevice.findMany({
      where: {
        isActive: true,
        traccarManaged: true,
        traccarDeviceId: { not: null },
      },
      select: {
        id: true,
        deviceCode: true,
        traccarDeviceId: true,
        lastSeenAt: true,
        lastRecordedAt: true,
      },
    });

    if (devices.length === 0) return;

    for (const device of devices) {
      try {
        // Heartbeat (`lastUpdate` on the device record) and the latest GPS
        // fix can diverge — the device might still be online with Traccar
        // while its GPS chip hasn't produced a new fix in hours. Fetch
        // both so we can update lastSeenAt independently of lastRecordedAt.
        const [remoteDevice, position] = await Promise.all([
          fetchTraccarDeviceById(device.traccarDeviceId!),
          fetchTraccarLatestPositionForDevice(device.traccarDeviceId!),
        ]);

        // Update lastSeenAt from Traccar's heartbeat even when no new GPS
        // fix arrived. Otherwise a stationary-but-online device drifts to
        // OFFLINE simply because we stopped ingesting (the existing flow
        // only updated lastSeenAt inside ingestGpsDeviceLocationService).
        const heartbeatIso =
          remoteDevice?.lastUpdate ?? position?.serverTime ?? null;
        const heartbeatTime = heartbeatIso ? new Date(heartbeatIso) : null;
        if (
          heartbeatTime &&
          !Number.isNaN(heartbeatTime.getTime()) &&
          (!device.lastSeenAt ||
            heartbeatTime.getTime() > device.lastSeenAt.getTime())
        ) {
          await prisma.gpsDevice.update({
            where: { id: device.id },
            data: { lastSeenAt: heartbeatTime },
          });
        }

        if (!position) continue;

        // Prefer Traccar's `serverTime` (when Traccar received the packet)
        // over the device-reported `fixTime`. Some device firmware — notably
        // ConCox GT06 — reports fixTime without a UTC offset, so Traccar's
        // fixTime can end up several hours behind real time even when the
        // device is actively moving. ServerTime is monotonic and
        // timezone-correct because it comes from Traccar's clock, not the
        // device's clock.
        const fixIso =
          position.serverTime ?? position.fixTime ?? position.deviceTime;
        const fixTime = fixIso ? new Date(fixIso) : null;
        if (!fixTime || Number.isNaN(fixTime.getTime())) continue;

        // The ingest pipeline already enforces monotonic timestamps + rate
        // limits, but checking here avoids the noise of doing the call only
        // to have it filtered out.
        if (
          device.lastRecordedAt &&
          fixTime.getTime() <= device.lastRecordedAt.getTime()
        ) {
          continue;
        }

        await ingestGpsDeviceLocationService({
          gpsDeviceId: device.id,
          deviceCode: device.deviceCode,
          lat: position.latitude,
          lng: position.longitude,
          speedKmh: position.speed != null ? position.speed * KNOTS_TO_KMH : null,
          heading: position.course != null ? Math.round(position.course) : null,
          accuracyM: position.accuracy != null ? position.accuracy : null,
          recordedAt: fixTime,
          rawPayload: { source: "traccar_poll", ...position.raw },
          requestIp: null,
        });
      } catch (err) {
        pollLogger.warn(
          {
            err,
            gpsDeviceId: device.id,
            deviceCode: device.deviceCode,
            traccarDeviceId: device.traccarDeviceId,
          },
          "traccar poll failed for device",
        );
      }
    }
  } catch (err) {
    pollLogger.error({ err }, "traccar poll cycle failed");
  } finally {
    cycleRunning = false;
  }
}

export function startTraccarPollJob() {
  if (timer) return;

  if (!env.TRACCAR_POLL_ENABLED) {
    pollLogger.info("Traccar polling disabled via TRACCAR_POLL_ENABLED");
    return;
  }

  if (!isTraccarConfigured()) {
    pollLogger.info(
      "Traccar credentials not configured; poll job will not start.",
    );
    return;
  }

  const intervalMs = Math.max(2000, Number(env.TRACCAR_POLL_INTERVAL_MS ?? 8000));
  pollLogger.info({ intervalMs }, "starting traccar poll job");

  timer = setInterval(() => {
    void pollOnce();
  }, intervalMs);

  // Kick once at startup so positions land without waiting a full interval.
  void pollOnce();
}

export function stopTraccarPollJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
