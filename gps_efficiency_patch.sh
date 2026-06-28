#!/usr/bin/env bash
# =====================================================================
# UniBus Live — GPS efficiency patch (trip-aware idle throttling)
#
# Stops the backend from polling/ingesting a bus's GPS every 8s while it
# is parked. On-trip buses (PRE_TRIP/RUNNING) keep full 8s polling; idle
# buses are polled only every TRACCAR_IDLE_POLL_INTERVAL_MS (default 60s).
# Eliminates the bulk of the ~98% idle ingests, cuts DB bloat + server load,
# and preserves GPS auto-start. Fully reversible (set TRACCAR_POLL_TRIP_AWARE=false).
#
# RUN ON THE VPS:   cd /opt/bus-tracking-backend && bash gps_efficiency_patch.sh
# =====================================================================
set -e
APP=/opt/bus-tracking-backend
cd "$APP"

echo "==> 1/4  Backing up + writing trip-aware poll job"
cp src/services/traccarPoll.job.ts "src/services/traccarPoll.job.ts.bak.$(date +%s)" 2>/dev/null || true
cat > src/services/traccarPoll.job.ts << 'TSEOF'
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

// Trip-aware idle throttle. A bus that is NOT in an active (PRE_TRIP/RUNNING)
// trip is "idle": its tracker still reports continuously, but we do not need
// that data 8 s apart. We poll idle devices only on a slow heartbeat so we
// still (a) keep lastSeenAt fresh and (b) can detect GPS-triggered auto-start,
// while eliminating the ~98% of ingests that occur while buses are parked.
// On-trip devices are always polled at the full interval.
const idleLastPolledMs = new Map<string, number>();

async function pollOnce() {
  if (cycleRunning) return;
  cycleRunning = true;

  try {
    if (!isTraccarConfigured()) return;

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

    // ---- Trip-aware gating -------------------------------------------------
    // Build (a) the set of buses currently on an active trip and (b) a
    // gpsDevice -> busId map from the active assignments, so we can decide
    // per device whether it is on a trip right now.
    const tripAware = env.TRACCAR_POLL_TRIP_AWARE !== false;
    let activeBusIds = new Set<string>();
    let deviceToBus = new Map<string, string>();

    if (tripAware) {
      const [activeTrips, assignments] = await Promise.all([
        prisma.trip.findMany({
          where: { status: { in: ["PRE_TRIP", "RUNNING"] } },
          select: { busId: true },
        }),
        prisma.busGpsDeviceAssignment.findMany({
          where: { isActive: true, unassignedAt: null },
          select: { busId: true, gpsDeviceId: true },
        }),
      ]);
      activeBusIds = new Set(activeTrips.map((t) => t.busId));
      deviceToBus = new Map(assignments.map((a) => [a.gpsDeviceId, a.busId]));
    }

    const idleIntervalMs = Math.max(
      8000,
      Number(env.TRACCAR_IDLE_POLL_INTERVAL_MS ?? 60000),
    );
    const now = Date.now();
    let skippedIdle = 0;

    for (const device of devices) {
      // Skip idle (not-on-trip) devices except on the slow heartbeat.
      if (tripAware) {
        const busId = deviceToBus.get(device.id);
        const onTrip = busId ? activeBusIds.has(busId) : false;
        if (!onTrip) {
          const last = idleLastPolledMs.get(device.id) ?? 0;
          if (now - last < idleIntervalMs) {
            skippedIdle += 1;
            continue;
          }
          idleLastPolledMs.set(device.id, now);
        }
      }

      try {
        const [remoteDevice, position] = await Promise.all([
          fetchTraccarDeviceById(device.traccarDeviceId!),
          fetchTraccarLatestPositionForDevice(device.traccarDeviceId!),
        ]);

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

        const fixIso =
          position.serverTime ?? position.fixTime ?? position.deviceTime;
        const fixTime = fixIso ? new Date(fixIso) : null;
        if (!fixTime || Number.isNaN(fixTime.getTime())) continue;

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

    if (tripAware && skippedIdle > 0) {
      pollLogger.debug(
        { skippedIdle, activeBuses: activeBusIds.size },
        "traccar poll: throttled idle devices",
      );
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
  pollLogger.info(
    {
      intervalMs,
      tripAware: env.TRACCAR_POLL_TRIP_AWARE !== false,
      idleIntervalMs: Number(env.TRACCAR_IDLE_POLL_INTERVAL_MS ?? 60000),
    },
    "starting traccar poll job",
  );

  timer = setInterval(() => {
    void pollOnce();
  }, intervalMs);

  void pollOnce();
}

export function stopTraccarPollJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
TSEOF

echo "==> 2/4  Adding env defaults (idempotent)"
if ! grep -q "TRACCAR_POLL_TRIP_AWARE" src/config/env.ts; then
python3 - << 'PY'
p="src/config/env.ts"; s=open(p).read()
a='  TRACCAR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(8000),'
add=('\n  TRACCAR_POLL_TRIP_AWARE: z.coerce.boolean().default(true),\n'
     '  TRACCAR_IDLE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),')
assert a in s, "env anchor not found"
s=s.replace(a,a+add,1); open(p,"w").write(s)
PY
fi
echo "    env vars present: $(grep -c 'TRACCAR_POLL_TRIP_AWARE\|TRACCAR_IDLE_POLL_INTERVAL_MS' src/config/env.ts)  (expect 2)"

echo "==> 3/4  Building"
npm run build

echo "==> 4/4  Restarting"
systemctl restart bus-backend
sleep 5
echo "    service: $(systemctl is-active bus-backend)"
echo ""
echo "DONE. Idle buses now poll every 60s instead of every 8s."
echo "Tune or disable in /opt/bus-tracking-backend/.env :"
echo "    TRACCAR_POLL_TRIP_AWARE=true        # false = revert to old behaviour"
echo "    TRACCAR_IDLE_POLL_INTERVAL_MS=60000 # raise to save more (e.g. 120000)"
echo ""
echo "To save to GitHub:  git add -A && git commit -m 'gps: trip-aware idle poll throttling' && git push"
