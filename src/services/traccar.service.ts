import { Buffer } from "node:buffer";

type LocalGpsDeviceForTraccar = {
  id: string;
  deviceCode: string;
  displayName: string | null;
  serialNumber: string | null;
  vendorName: string | null;
  modelName: string | null;
  imei: string | null;
  isActive: boolean;
  traccarDeviceId: number | null;
  traccarUniqueId: string | null;
  traccarServerBaseUrl: string | null;
};

export type TraccarRemoteDeviceSummary = {
  id: number;
  name: string | null;
  uniqueId: string;
  status: string | null;
  disabled: boolean;
  lastUpdate: string | null;
};

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export function getTraccarBaseUrl() {
  const value = process.env.TRACCAR_BASE_URL?.trim();
  if (!value) return null;
  return normalizeBaseUrl(value);
}

export function isTraccarConfigured() {
  const baseUrl = getTraccarBaseUrl();
  const hasToken = Boolean(process.env.TRACCAR_API_TOKEN?.trim());
  const hasBasic =
    Boolean(process.env.TRACCAR_USERNAME?.trim()) &&
    Boolean(process.env.TRACCAR_PASSWORD?.trim());

  return Boolean(baseUrl && (hasToken || hasBasic));
}

/**
 * Traccar authentication.
 *
 * This server's Traccar (v6) only accepts an API token via the
 * `/session?token=` endpoint, which logs in and returns a JSESSIONID
 * cookie. The token is NOT honoured on data endpoints (`/devices`,
 * `/positions`, …) — those return 401 unless the request carries that
 * session cookie. (`Authorization: Bearer` is rejected outright with a
 * 404.) So for token auth we:
 *   1. GET /session?token=<token>  → capture JSESSIONID
 *   2. send that cookie on every subsequent request
 *   3. re-login once on a 401 (cookie expired / server restarted)
 *
 * Username/password still works via plain HTTP Basic as a fallback and
 * needs no session dance.
 */
let cachedSessionCookie: string | null = null;

function getBasicAuthHeader(): Record<string, string> | null {
  const username = process.env.TRACCAR_USERNAME?.trim();
  const password = process.env.TRACCAR_PASSWORD?.trim();
  if (!username || !password) return null;
  const basic = Buffer.from(`${username}:${password}`).toString("base64");
  return { Authorization: `Basic ${basic}` };
}

/**
 * Log in with the API token and cache the returned JSESSIONID cookie.
 * Returns the cookie string (e.g. "JSESSIONID=abc") or null on failure.
 */
async function loginWithTokenForCookie(baseUrl: string): Promise<string | null> {
  const token = process.env.TRACCAR_API_TOKEN?.trim();
  if (!token) return null;

  const res = await fetch(`${baseUrl}/session?token=${encodeURIComponent(token)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    cachedSessionCookie = null;
    return null;
  }

  // Node's fetch joins multiple Set-Cookie headers with commas; scan for
  // the JSESSIONID by name so we don't grab an unrelated cookie.
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = /JSESSIONID=([^;,\s]+)/.exec(setCookie);
  cachedSessionCookie = match ? `JSESSIONID=${match[1]}` : null;
  return cachedSessionCookie;
}

async function traccarRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getTraccarBaseUrl();
  if (!baseUrl) {
    throw new Error(
      "Traccar base URL is not configured. Set TRACCAR_BASE_URL.",
    );
  }

  const usingToken = Boolean(process.env.TRACCAR_API_TOKEN?.trim());
  const basicHeader = usingToken ? null : getBasicAuthHeader();

  if (!usingToken && !basicHeader) {
    throw new Error(
      "Traccar is not configured. Set TRACCAR_BASE_URL and either TRACCAR_API_TOKEN or TRACCAR_USERNAME/TRACCAR_PASSWORD.",
    );
  }

  const doFetch = async (cookie: string | null) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(basicHeader ?? {}),
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (cookie) headers.Cookie = cookie;
    return fetch(`${baseUrl}${path}`, { ...init, headers });
  };

  // Token auth: ensure we have a session cookie before the data request.
  if (usingToken && !cachedSessionCookie) {
    await loginWithTokenForCookie(baseUrl);
  }

  let response = await doFetch(usingToken ? cachedSessionCookie : null);

  // A 401 on token auth means the cookie expired (or the server restarted
  // and forgot our session). Re-login once and retry before giving up.
  if (response.status === 401 && usingToken) {
    const fresh = await loginWithTokenForCookie(baseUrl);
    if (fresh) {
      response = await doFetch(fresh);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Traccar API request failed (${response.status} ${response.statusText}): ${
        text || "No response body"
      }`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function buildTraccarUniqueId(device: LocalGpsDeviceForTraccar) {
  return (
    device.traccarUniqueId?.trim() ||
    device.imei?.trim() ||
    device.serialNumber?.trim() ||
    device.deviceCode.trim()
  );
}

function buildTraccarDeviceName(device: LocalGpsDeviceForTraccar) {
  return device.displayName?.trim() || device.deviceCode.trim();
}

function mapRemoteDevice(item: any): TraccarRemoteDeviceSummary {
  return {
    id: Number(item.id),
    name: typeof item.name === "string" ? item.name : null,
    uniqueId: String(item.uniqueId),
    status: typeof item.status === "string" ? item.status : null,
    disabled: Boolean(item.disabled),
    lastUpdate: typeof item.lastUpdate === "string" ? item.lastUpdate : null,
  };
}

export async function fetchTraccarDeviceById(id: number) {
  const result = await traccarRequest<any>(`/devices?id=${id}&all=true`, {
    method: "GET",
  });

  if (!Array.isArray(result) || result.length === 0) return null;
  return mapRemoteDevice(result[0]);
}

export async function fetchTraccarDeviceByUniqueId(uniqueId: string) {
  const encoded = encodeURIComponent(uniqueId);
  const result = await traccarRequest<any>(
    `/devices?uniqueId=${encoded}&all=true`,
    {
      method: "GET",
    },
  );

  if (!Array.isArray(result) || result.length === 0) return null;
  return mapRemoteDevice(result[0]);
}

export async function createTraccarDevice(device: LocalGpsDeviceForTraccar) {
  const uniqueId = buildTraccarUniqueId(device);

  const payload = {
    name: buildTraccarDeviceName(device),
    uniqueId,
    model: device.modelName ?? undefined,
    disabled: !device.isActive,
    attributes: {
      localGpsDeviceId: device.id,
      localDeviceCode: device.deviceCode,
      vendorName: device.vendorName ?? null,
    },
  };

  const created = await traccarRequest<any>("/devices", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return mapRemoteDevice(created);
}

export async function updateTraccarDevice(
  traccarDeviceId: number,
  device: LocalGpsDeviceForTraccar,
) {
  const uniqueId = buildTraccarUniqueId(device);

  const payload = {
    id: traccarDeviceId,
    name: buildTraccarDeviceName(device),
    uniqueId,
    model: device.modelName ?? undefined,
    disabled: !device.isActive,
    attributes: {
      localGpsDeviceId: device.id,
      localDeviceCode: device.deviceCode,
      vendorName: device.vendorName ?? null,
    },
  };

  const updated = await traccarRequest<any>(`/devices/${traccarDeviceId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  return mapRemoteDevice(updated);
}

export async function reconcileTraccarDevice(device: LocalGpsDeviceForTraccar) {
  const uniqueId = buildTraccarUniqueId(device);

  let remote =
    device.traccarDeviceId != null
      ? await fetchTraccarDeviceById(device.traccarDeviceId)
      : null;

  if (!remote) {
    remote = await fetchTraccarDeviceByUniqueId(uniqueId);
  }

  if (!remote) {
    remote = await createTraccarDevice(device);
  } else {
    remote = await updateTraccarDevice(remote.id, device);
  }

  return {
    remoteDevice: remote,
    resolvedUniqueId: uniqueId,
    resolvedServerBaseUrl: getTraccarBaseUrl(),
  };
}

export type TraccarRemotePosition = {
  id: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  /** Knots — convert to km/h with `*1.852` when ingesting. */
  speed: number | null;
  course: number | null;
  accuracy: number | null;
  fixTime: string | null;
  deviceTime: string | null;
  serverTime: string | null;
  raw: Record<string, unknown>;
};

function parseTraccarPosition(item: any): TraccarRemotePosition | null {
  if (!item || typeof item !== "object") return null;

  const lat = Number(item.latitude);
  const lng = Number(item.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const speed =
    item.speed != null && Number.isFinite(Number(item.speed))
      ? Number(item.speed)
      : null;
  const course =
    item.course != null && Number.isFinite(Number(item.course))
      ? Number(item.course)
      : null;
  const accuracy =
    item.accuracy != null && Number.isFinite(Number(item.accuracy))
      ? Number(item.accuracy)
      : null;

  return {
    id: Number(item.id),
    deviceId: Number(item.deviceId),
    latitude: lat,
    longitude: lng,
    speed,
    course,
    accuracy,
    fixTime: typeof item.fixTime === "string" ? item.fixTime : null,
    deviceTime: typeof item.deviceTime === "string" ? item.deviceTime : null,
    serverTime: typeof item.serverTime === "string" ? item.serverTime : null,
    raw: item as Record<string, unknown>,
  };
}

/**
 * Latest reported position for a Traccar device. Traccar returns an array of
 * the most recent positions when called without a time window — we take the
 * first one (newest).
 */
export async function fetchTraccarLatestPositionForDevice(
  traccarDeviceId: number,
): Promise<TraccarRemotePosition | null> {
  const result = await traccarRequest<any>(
    `/positions?deviceId=${traccarDeviceId}`,
    { method: "GET" },
  );

  if (!Array.isArray(result) || result.length === 0) return null;
  return parseTraccarPosition(result[0]);
}

export async function getTraccarDeviceStatus(device: LocalGpsDeviceForTraccar) {
  const uniqueId = buildTraccarUniqueId(device);

  const remote =
    device.traccarDeviceId != null
      ? await fetchTraccarDeviceById(device.traccarDeviceId)
      : await fetchTraccarDeviceByUniqueId(uniqueId);

  // Pull the latest position alongside the device record so the Diagnose UI
  // can distinguish a fresh heartbeat (`lastUpdate`) from a stale GPS fix
  // (`fixTime`) — the most common reason a device is "online" but our
  // backend's `lastRecordedAt` doesn't move forward.
  let latestPosition: TraccarRemotePosition | null = null;
  if (remote?.id != null) {
    try {
      latestPosition = await fetchTraccarLatestPositionForDevice(remote.id);
    } catch {
      latestPosition = null;
    }
  }

  return {
    remoteDevice: remote,
    latestPosition,
    resolvedUniqueId: uniqueId,
    resolvedServerBaseUrl: getTraccarBaseUrl(),
  };
}
