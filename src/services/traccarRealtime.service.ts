import WebSocket from "ws";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  getTraccarBaseUrl,
  isTraccarConfigured,
} from "./traccar.service.js";
import { ingestGpsDeviceLocationService } from "./gpsIngest.service.js";

const log = logger.child({ scope: "traccarRealtime" });

const KNOTS_TO_KMH = 1.852;
const DEVICE_CACHE_TTL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let stopping = false;

// traccarDeviceId → { local gpsDevice.id, deviceCode }. Refreshed every
// minute (and on cache miss) so newly-reconciled devices show up without
// reconnecting the socket.
const deviceCache = new Map<number, { id: string; deviceCode: string }>();
let deviceCacheRefreshedAt = 0;

function getAuthHeaders(): Record<string, string> {
  const token = process.env.TRACCAR_API_TOKEN?.trim();
  if (token) return { Authorization: `Bearer ${token}` };

  const username = process.env.TRACCAR_USERNAME?.trim();
  const password = process.env.TRACCAR_PASSWORD?.trim();
  if (!username || !password) return {};

  const basic = Buffer.from(`${username}:${password}`).toString("base64");
  return { Authorization: `Basic ${basic}` };
}

/**
 * Traccar's WebSocket is a session-cookie protocol — we have to hit the HTTP
 * `/session` endpoint with our auth first, capture the `JSESSIONID` cookie,
 * then pass that on the WebSocket upgrade request.
 */
let lastAuthFailStatus: number | null = null;
let authFailRepeatCount = 0;

async function getTraccarSessionCookie(): Promise<string | null> {
  const baseUrl = getTraccarBaseUrl();
  if (!baseUrl) return null;

  // Traccar v6 rejects `Authorization: Bearer` (404) and only honours the
  // token as a `?token=` query param. Authenticating GET /session that way
  // still establishes the server-side session and returns the JSESSIONID
  // cookie we hand to the WebSocket upgrade. Username/password falls back
  // to the Basic header.
  const token = process.env.TRACCAR_API_TOKEN?.trim();
  let url = `${baseUrl}/session`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  } else {
    Object.assign(headers, getAuthHeaders());
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    // After the first failure, downgrade subsequent identical-status
    // logs to DEBUG so a misconfigured / unreachable Traccar doesn't
    // drown the log file in WARN entries every minute. Surface a
    // single WARN every ~hour as a heartbeat so the issue isn't
    // completely silent. Resets on success.
    if (lastAuthFailStatus === res.status) {
      authFailRepeatCount += 1;
      if (authFailRepeatCount % 60 === 0) {
        log.warn(
          { status: res.status, suppressedSince: authFailRepeatCount },
          "traccar session auth failing repeatedly",
        );
      } else {
        log.debug({ status: res.status }, "traccar session auth failed");
      }
    } else {
      lastAuthFailStatus = res.status;
      authFailRepeatCount = 1;
      log.warn({ status: res.status }, "traccar session auth failed");
    }
    return null;
  }

  // Reset the warn-suppression counter on success so the next outage
  // surfaces a fresh WARN.
  lastAuthFailStatus = null;
  authFailRepeatCount = 0;

  // Node's fetch returns a Headers object; multiple Set-Cookie headers are
  // joined with commas, so we scan for JSESSIONID by name.
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = /JSESSIONID=([^;,\s]+)/.exec(setCookie);
  return match ? `JSESSIONID=${match[1]}` : null;
}

async function refreshDeviceCacheIfStale() {
  const now = Date.now();
  if (now - deviceCacheRefreshedAt < DEVICE_CACHE_TTL_MS && deviceCache.size > 0) {
    return;
  }

  const devices = await prisma.gpsDevice.findMany({
    where: {
      isActive: true,
      traccarManaged: true,
      traccarDeviceId: { not: null },
    },
    select: { id: true, deviceCode: true, traccarDeviceId: true },
  });

  deviceCache.clear();
  for (const d of devices) {
    if (d.traccarDeviceId != null) {
      deviceCache.set(d.traccarDeviceId, { id: d.id, deviceCode: d.deviceCode });
    }
  }
  deviceCacheRefreshedAt = now;
}

async function handlePosition(position: any) {
  const traccarDeviceId = Number(position?.deviceId);
  if (!Number.isFinite(traccarDeviceId)) return;

  let local = deviceCache.get(traccarDeviceId);

  // Cache miss could mean a freshly reconciled device — refresh once and try
  // again before giving up.
  if (!local) {
    await refreshDeviceCacheIfStale();
    local = deviceCache.get(traccarDeviceId);
    if (!local) return;
  }

  const lat = Number(position.latitude);
  const lng = Number(position.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  // Same timezone-correctness reasoning as the poll job: serverTime comes
  // from Traccar's own clock so it's reliable; fixTime can be wrong when
  // device firmware reports without a UTC offset.
  const seenIso =
    typeof position.serverTime === "string"
      ? position.serverTime
      : typeof position.fixTime === "string"
        ? position.fixTime
        : typeof position.deviceTime === "string"
          ? position.deviceTime
          : null;
  if (!seenIso) return;

  const recordedAt = new Date(seenIso);
  if (Number.isNaN(recordedAt.getTime())) return;

  try {
    await ingestGpsDeviceLocationService({
      gpsDeviceId: local.id,
      deviceCode: local.deviceCode,
      lat,
      lng,
      speedKmh:
        typeof position.speed === "number" ? position.speed * KNOTS_TO_KMH : null,
      heading:
        typeof position.course === "number" ? Math.round(position.course) : null,
      accuracyM:
        typeof position.accuracy === "number" ? position.accuracy : null,
      recordedAt,
      rawPayload: { source: "traccar_ws", ...position },
      requestIp: null,
    });
  } catch (err) {
    log.warn(
      { err, gpsDeviceId: local.id, deviceCode: local.deviceCode },
      "traccar ws position ingest failed",
    );
  }
}

function handleMessage(raw: WebSocket.RawData) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (!parsed || typeof parsed !== "object") return;

  const positions = (parsed as { positions?: unknown }).positions;
  if (!Array.isArray(positions)) return;

  for (const position of positions) {
    void handlePosition(position);
  }
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function scheduleReconnect(reason: string) {
  if (stopping) return;
  if (reconnectTimer) return;

  reconnectAttempts += 1;
  const baseDelay = Math.min(60_000, 1_000 * 2 ** Math.min(6, reconnectAttempts));
  // Jitter so multiple instances don't reconnect in lockstep.
  const delayMs = baseDelay + Math.floor(Math.random() * 1_000);

  log.info(
    { reason, attempt: reconnectAttempts, delayMs },
    "scheduling traccar realtime reconnect",
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delayMs);
}

async function connect() {
  if (stopping) return;
  if (!isTraccarConfigured()) {
    log.info("traccar realtime: not configured, skipping connect");
    return;
  }

  try {
    const cookie = await getTraccarSessionCookie();
    if (!cookie) {
      scheduleReconnect("no session cookie");
      return;
    }

    await refreshDeviceCacheIfStale();

    const httpBase = getTraccarBaseUrl();
    if (!httpBase) {
      scheduleReconnect("no base url");
      return;
    }

    const wsUrl = httpBase.replace(/^http/i, "ws") + "/socket";

    log.info({ wsUrl }, "connecting to traccar websocket");

    const socket = new WebSocket(wsUrl, {
      headers: { Cookie: cookie },
      handshakeTimeout: 15_000,
    });

    ws = socket;

    socket.on("open", () => {
      reconnectAttempts = 0;
      log.info("traccar websocket connected");

      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.ping();
          } catch {
            // The socket lifecycle is handled by close/error events.
          }
        }
      }, HEARTBEAT_INTERVAL_MS);
    });

    socket.on("message", handleMessage);

    socket.on("close", (code, reasonBuf) => {
      clearHeartbeat();
      ws = null;
      log.warn(
        { code, reason: reasonBuf?.toString() ?? null },
        "traccar websocket closed",
      );
      scheduleReconnect("close");
    });

    socket.on("error", (err) => {
      log.error({ err }, "traccar websocket error");
      // 'close' will fire after 'error' and trigger the reconnect.
    });
  } catch (err) {
    log.error({ err }, "traccar websocket connect failed");
    scheduleReconnect("error");
  }
}

export function startTraccarRealtime() {
  if (!env.TRACCAR_REALTIME_ENABLED) {
    log.info("traccar realtime disabled via TRACCAR_REALTIME_ENABLED");
    return;
  }
  if (!isTraccarConfigured()) {
    log.info("traccar credentials not configured; realtime will not start");
    return;
  }

  stopping = false;
  void connect();
}

export function stopTraccarRealtime() {
  stopping = true;
  clearHeartbeat();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      // Best effort.
    }
    ws = null;
  }
}
