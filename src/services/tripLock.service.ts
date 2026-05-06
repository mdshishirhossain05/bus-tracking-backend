import { redis } from "../config/redis.js";
import { env } from "../config/env.js";

const LOCK_TTL_MS = Number(env.TRIP_LOCK_TTL_MS ?? 10000);

function busLockKey(busId: string) {
  return `lock:bus:${busId}`;
}

function driverLockKey(driverId: string) {
  return `lock:driver:${driverId}`;
}

export type TripLock = {
  busKey: string;
  driverKey: string;
  token: string;
};

function randomToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * Acquire both bus + driver locks.
 * Uses same token so release is simple and safe.
 */
export async function acquireTripStartLock(params: {
  busId: string;
  driverId: string;
}): Promise<{ ok: true; lock: TripLock } | { ok: false; reason: string }> {
  const { busId, driverId } = params;

  const token = randomToken();
  const busKey = busLockKey(busId);
  const driverKey = driverLockKey(driverId);

  const busOk = await redis.set(busKey, token, {
    PX: LOCK_TTL_MS,
    NX: true,
  });

  if (busOk !== "OK") {
    return { ok: false, reason: "BUS_LOCKED" };
  }

  const driverOk = await redis.set(driverKey, token, {
    PX: LOCK_TTL_MS,
    NX: true,
  });

  if (driverOk !== "OK") {
    await releaseLockKey(busKey, token);
    return { ok: false, reason: "DRIVER_LOCKED" };
  }

  return {
    ok: true,
    lock: { busKey, driverKey, token },
  };
}

async function releaseLockKey(key: string, token: string) {
  const lua = `
local key = KEYS[1]
local token = ARGV[1]
local current = redis.call("GET", key)
if current == token then
  return redis.call("DEL", key)
end
return 0
`;

  await redis.eval(lua, {
    keys: [key],
    arguments: [token],
  });
}

export async function releaseTripStartLock(lock: TripLock): Promise<void> {
  await Promise.all([
    releaseLockKey(lock.busKey, lock.token),
    releaseLockKey(lock.driverKey, lock.token),
  ]);
}
