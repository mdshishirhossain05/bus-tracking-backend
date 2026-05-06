// src/services/locationRateLimiter.ts

type LocationState = {
  lastRequestAt: number;
  lastRecordedAt?: number;
};

const locationStateMap = new Map<string, LocationState>();

export function canSendLocation(
  key: string,
  minIntervalMs: number,
): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const state = locationStateMap.get(key);

  if (!state) {
    locationStateMap.set(key, { lastRequestAt: now });
    return { allowed: true };
  }

  if (now - state.lastRequestAt < minIntervalMs) {
    return { allowed: false, reason: "RATE_LIMITED" };
  }

  state.lastRequestAt = now;
  return { allowed: true };
}

export function isMonotonic(
  key: string,
  recordedAt: Date,
): { allowed: boolean; reason?: string } {
  const state = locationStateMap.get(key);

  if (!state) return { allowed: true };

  const ts = recordedAt.getTime();

  if (state.lastRecordedAt != null && ts <= state.lastRecordedAt) {
    return { allowed: false, reason: "STALE_TIMESTAMP" };
  }

  state.lastRecordedAt = ts;
  return { allowed: true };
}

export function clearLocationState(key: string) {
  locationStateMap.delete(key);
}
