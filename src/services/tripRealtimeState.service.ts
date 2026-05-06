import { redis } from "../config/redis.js";
import { env } from "../config/env.js";

export type TripRealtimeSourceType = "DRIVER_MOBILE" | "GPS_DEVICE";
export type TripRealtimeSourceStatus =
  | "HEALTHY"
  | "STALE"
  | "UNHEALTHY"
  | "DISCONNECTED";
export type TripRealtimeSelectionReason =
  | "DRIVER_ONLY"
  | "GPS_ONLY"
  | "GPS_PRIORITY"
  | "DRIVER_PRIORITY"
  | "GPS_FALLBACK_TO_DRIVER"
  | "DRIVER_FALLBACK_TO_GPS"
  | "MOST_RECENT_HEALTHY"
  | "NO_HEALTHY_SOURCE"
  | "STICKY_PREVIOUS_SOURCE"
  | "HOLD_LAST_GOOD_STATE";

export type TripRealtimeSample = {
  lat: number;
  lng: number;
  speedKmh: number;
  recordedAt: string;
};

export type TripRealtimeState = {
  lat: number;
  lng: number;
  speedKmh: number | null;
  rawSpeedKmh: number | null;
  averageSpeedKmh: number | null;
  displaySpeedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  recordedAt: string;
  isStationary: boolean;
  distanceDeltaMeters: number | null;
  elapsedSeconds: number | null;
  acceptedPointCount: number;

  sourceType: TripRealtimeSourceType;
  sourceStatus: TripRealtimeSourceStatus;
  selectionReason: TripRealtimeSelectionReason;
  sourceLabel: string | null;

  samples: TripRealtimeSample[];
};

type ParsedTripRealtimeState = Omit<
  TripRealtimeState,
  "recordedAt" | "samples"
> & {
  recordedAt: Date;
  samples: Array<{
    lat: number;
    lng: number;
    speedKmh: number;
    recordedAt: Date;
  }>;
};

function selectedKey(tripId: string) {
  return `tripState:${tripId}`;
}

function sourceKey(tripId: string, sourceType: TripRealtimeSourceType) {
  return `tripState:${tripId}:source:${sourceType}`;
}

function lastGoodKey(tripId: string) {
  return `tripState:${tripId}:lastGood`;
}

const TTL_SECONDS = Number(env.TRIP_STATE_TTL_SECONDS ?? 180);
const LAST_GOOD_TTL_SECONDS = Number(
  env.TRIP_LAST_GOOD_STATE_TTL_SECONDS ?? 300,
);

function parseState(raw: string): ParsedTripRealtimeState {
  const parsed = JSON.parse(raw) as TripRealtimeState;

  return {
    ...parsed,
    recordedAt: new Date(parsed.recordedAt),
    samples: Array.isArray(parsed.samples)
      ? parsed.samples.map((sample) => ({
          ...sample,
          recordedAt: new Date(sample.recordedAt),
        }))
      : [],
  };
}

export async function setTripRealtimeState(
  tripId: string,
  state: TripRealtimeState,
) {
  await redis.set(selectedKey(tripId), JSON.stringify(state), {
    EX: TTL_SECONDS,
  });
}

export async function getTripRealtimeState(
  tripId: string,
): Promise<ParsedTripRealtimeState | null> {
  const raw = await redis.get(selectedKey(tripId));
  if (!raw) return null;
  return parseState(raw);
}

export async function clearTripRealtimeState(tripId: string) {
  await redis.del(selectedKey(tripId));
}

export async function setTripSourceRealtimeState(
  tripId: string,
  sourceType: TripRealtimeSourceType,
  state: TripRealtimeState,
) {
  await redis.set(sourceKey(tripId, sourceType), JSON.stringify(state), {
    EX: TTL_SECONDS,
  });
}

export async function getTripSourceRealtimeState(
  tripId: string,
  sourceType: TripRealtimeSourceType,
): Promise<ParsedTripRealtimeState | null> {
  const raw = await redis.get(sourceKey(tripId, sourceType));
  if (!raw) return null;
  return parseState(raw);
}

export async function clearTripSourceRealtimeState(
  tripId: string,
  sourceType: TripRealtimeSourceType,
) {
  await redis.del(sourceKey(tripId, sourceType));
}

export async function setTripLastGoodRealtimeState(
  tripId: string,
  state: TripRealtimeState,
) {
  await redis.set(lastGoodKey(tripId), JSON.stringify(state), {
    EX: LAST_GOOD_TTL_SECONDS,
  });
}

export async function getTripLastGoodRealtimeState(
  tripId: string,
): Promise<ParsedTripRealtimeState | null> {
  const raw = await redis.get(lastGoodKey(tripId));
  if (!raw) return null;
  return parseState(raw);
}

export async function clearTripLastGoodRealtimeState(tripId: string) {
  await redis.del(lastGoodKey(tripId));
}
