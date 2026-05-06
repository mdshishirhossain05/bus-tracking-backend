import { env } from "../config/env.js";
import { haversineMeters } from "../utils/geo.js";
import {
  getTripRealtimeState,
  type TripRealtimeState,
  type TripRealtimeSample,
} from "./tripRealtimeState.service.js";

type IncomingTrackingPoint = {
  tripId: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  recordedAt: Date;
};

type FilteredTrackingResult = {
  accepted: boolean;
  reason?: string;
  state: TripRealtimeState;
};

type SampleLike = {
  lat: number;
  lng: number;
  speedKmh: number;
  recordedAt: Date | string;
};

const DRIVER_SOURCE_META = {
  sourceType: "DRIVER_MOBILE" as const,
  sourceStatus: "HEALTHY" as const,
  selectionReason: "DRIVER_ONLY" as const,
  sourceLabel: "Driver Mobile",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getOptionalEnvNumber(name: string, fallback: number) {
  const raw = process.env[name];

  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeSpeed(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return clamp(value, 0, Number(env.LOCATION_MAX_SERVER_SPEED_KMH ?? 120));
}

function sanitizeAccuracy(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function toIsoString(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toRealtimeSamples(samples: SampleLike[]): TripRealtimeSample[] {
  return samples.map((sample) => ({
    lat: sample.lat,
    lng: sample.lng,
    speedKmh: round(sample.speedKmh, 1),
    recordedAt: toIsoString(sample.recordedAt),
  }));
}

function computeRollingAverageKmh(
  samples: TripRealtimeSample[],
  {
    minSegmentDistanceM,
    maxSegmentSpeedKmh,
  }: {
    minSegmentDistanceM: number;
    maxSegmentSpeedKmh: number;
  },
) {
  if (samples.length < 2) return null;

  let totalDistanceMeters = 0;
  let totalDurationMs = 0;

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (!prev || !curr) continue;

    const distanceMeters = haversineMeters(
      prev.lat,
      prev.lng,
      curr.lat,
      curr.lng,
    );

    const durationMs =
      new Date(curr.recordedAt).getTime() - new Date(prev.recordedAt).getTime();

    if (durationMs <= 0) continue;

    const hours = durationMs / 3_600_000;
    if (hours <= 0) continue;

    const segmentSpeedKmh = distanceMeters / 1000 / hours;

    if (distanceMeters < minSegmentDistanceM) continue;
    if (
      !Number.isFinite(segmentSpeedKmh) ||
      segmentSpeedKmh > maxSegmentSpeedKmh
    ) {
      continue;
    }

    totalDistanceMeters += distanceMeters;
    totalDurationMs += durationMs;
  }

  if (totalDurationMs <= 0) return 0;
  if (totalDistanceMeters < 15) return 0;

  const averageKmh = totalDistanceMeters / 1000 / (totalDurationMs / 3_600_000);
  return round(averageKmh, 1);
}

function getAccuracyConfidence(accuracyM: number | null) {
  const maxAcceptable = Number(env.LOCATION_MAX_ACCEPTABLE_ACCURACY_M ?? 120);

  if (accuracyM == null) return 0.68;
  if (accuracyM <= 8) return 1;
  if (accuracyM <= 12) return 0.96;
  if (accuracyM <= 20) return 0.9;
  if (accuracyM <= 30) return 0.8;
  if (accuracyM <= 50) return 0.6;
  if (accuracyM <= 80) return 0.38;
  if (accuracyM <= maxAcceptable) return 0.2;
  return 0.08;
}

function smoothDisplaySpeed(params: {
  previousDisplaySpeedKmh: number | null;
  targetSpeedKmh: number;
  elapsedSeconds: number;
  isStationary: boolean;
  strongBrake: boolean;
}) {
  const {
    previousDisplaySpeedKmh,
    targetSpeedKmh,
    elapsedSeconds,
    isStationary,
    strongBrake,
  } = params;

  const prev = previousDisplaySpeedKmh ?? 0;
  const dt = Math.max(0.2, Math.min(elapsedSeconds, 4));

  const accelRate = Number(env.LOCATION_ACCELERATION_KMH_PER_SEC ?? 10);
  const decelRate = Number(env.LOCATION_DECELERATION_KMH_PER_SEC ?? 14);
  const strongBrakeRate = Number(env.LOCATION_STRONG_BRAKE_KMH_PER_SEC ?? 22);

  if (isStationary) {
    const next = Math.max(0, prev - strongBrakeRate * dt);
    return next <= 0.3 ? 0 : round(next, 1);
  }

  if (targetSpeedKmh > prev) {
    return round(Math.min(targetSpeedKmh, prev + accelRate * dt), 1);
  }

  return round(
    Math.max(
      targetSpeedKmh,
      prev - (strongBrake ? strongBrakeRate : decelRate) * dt,
    ),
    1,
  );
}

function computeRecentDistanceMeters(samples: TripRealtimeSample[]) {
  if (samples.length < 2) return 0;

  let total = 0;

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (!prev || !curr) continue;

    total += haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);
  }

  return total;
}

function computeWeightedObservedSpeedKmh(params: {
  serverDerivedSpeedKmh: number;
  rawSpeedKmh: number | null;
  accuracyConfidence: number;
  allowRawAssist: boolean;
}) {
  const {
    serverDerivedSpeedKmh,
    rawSpeedKmh,
    accuracyConfidence,
    allowRawAssist,
  } = params;

  if (!allowRawAssist || rawSpeedKmh == null) {
    return round(serverDerivedSpeedKmh, 1);
  }

  const rawWeight = clamp(0.16 + accuracyConfidence * 0.22, 0.16, 0.42);
  const serverWeight = 1 - rawWeight;

  return round(
    serverDerivedSpeedKmh * serverWeight + rawSpeedKmh * rawWeight,
    1,
  );
}

function computeCurrentSpeedKmh(params: {
  observedSpeedKmh: number;
  rawSpeedKmh: number | null;
  accuracyConfidence: number;
  isStationary: boolean;
  movementConfidence: number;
}) {
  const {
    observedSpeedKmh,
    rawSpeedKmh,
    accuracyConfidence,
    isStationary,
    movementConfidence,
  } = params;

  if (isStationary) return 0;

  if (rawSpeedKmh == null) {
    return round(observedSpeedKmh, 1);
  }

  const rawWeight = clamp(
    0.22 + accuracyConfidence * 0.18 + movementConfidence * 0.12,
    0.22,
    0.48,
  );
  const observedWeight = 1 - rawWeight;

  return round(observedSpeedKmh * observedWeight + rawSpeedKmh * rawWeight, 1);
}

export async function filterTrackingPoint(
  input: IncomingTrackingPoint,
): Promise<FilteredTrackingResult> {
  const previous = await getTripRealtimeState(input.tripId);

  const hardRejectAccuracyM = Number(
    env.LOCATION_HARD_REJECT_ACCURACY_M ?? 250,
  );
  const maxAcceptableAccuracyM = Number(
    env.LOCATION_MAX_ACCEPTABLE_ACCURACY_M ?? 120,
  );
  const stationaryThresholdKmh = Number(
    env.LOCATION_STATIONARY_SPEED_THRESHOLD_KMH ?? 3,
  );
  const minMovementDistanceM = Number(
    env.LOCATION_MIN_MOVEMENT_DISTANCE_M ?? 4,
  );
  const significantMovementDistanceM = Number(
    env.LOCATION_SIGNIFICANT_MOVEMENT_DISTANCE_M ?? 10,
  );
  const rollingWindowMs = Number(env.LOCATION_ROLLING_WINDOW_MS ?? 180000);

  const freezeAccuracyThresholdM = Number(
    env.LOCATION_FREEZE_ACCURACY_THRESHOLD_M ?? 35,
  );
  const releaseMovementDistanceM = Number(
    env.LOCATION_RELEASE_MOVEMENT_DISTANCE_M ?? 16,
  );
  const confirmMovementDistanceM = Number(
    env.LOCATION_CONFIRM_MOVEMENT_DISTANCE_M ?? 24,
  );
  const rawSpeedAssistMinKmh = Number(
    env.LOCATION_RAW_SPEED_ASSIST_MIN_KMH ?? 7,
  );
  const minElapsedForMovementSeconds = Number(
    env.LOCATION_MIN_ELAPSED_FOR_MOVEMENT_SECONDS ?? 2.1,
  );

  const rollingAverageMinSegmentDistanceM = getOptionalEnvNumber(
    "LOCATION_ROLLING_AVG_MIN_SEGMENT_DISTANCE_M",
    8,
  );
  const rollingAverageMaxSegmentSpeedKmh = getOptionalEnvNumber(
    "LOCATION_ROLLING_AVG_MAX_SEGMENT_SPEED_KMH",
    95,
  );
  const stationaryHoldDistanceM = getOptionalEnvNumber(
    "LOCATION_STATIONARY_HOLD_DISTANCE_M",
    8,
  );
  const stationaryReleaseSpeedKmh = getOptionalEnvNumber(
    "LOCATION_STATIONARY_RELEASE_SPEED_KMH",
    7,
  );
  const stationaryExitDistanceM = getOptionalEnvNumber(
    "LOCATION_STATIONARY_EXIT_DISTANCE_M",
    18,
  );

  const accuracyM = sanitizeAccuracy(input.accuracyM);
  const rawSpeedKmh = sanitizeSpeed(input.speedKmh);
  const accuracyConfidence = getAccuracyConfidence(accuracyM);

  if (accuracyM != null && accuracyM > hardRejectAccuracyM) {
    const previousDisplay = previous?.displaySpeedKmh ?? 0;
    const elapsedSeconds =
      previous?.recordedAt != null
        ? Math.max(
            0,
            (input.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000,
          )
        : 0;

    const slowedDisplay = smoothDisplaySpeed({
      previousDisplaySpeedKmh: previousDisplay,
      targetSpeedKmh: 0,
      elapsedSeconds,
      isStationary: true,
      strongBrake: true,
    });

    const fallbackState: TripRealtimeState =
      previous != null
        ? {
            lat: previous.lat,
            lng: previous.lng,
            speedKmh: 0,
            rawSpeedKmh,
            averageSpeedKmh: previous.averageSpeedKmh ?? 0,
            displaySpeedKmh: slowedDisplay,
            heading: previous.heading ?? input.heading ?? null,
            accuracyM,
            recordedAt: input.recordedAt.toISOString(),
            isStationary: true,
            distanceDeltaMeters: 0,
            elapsedSeconds: round(elapsedSeconds, 1),
            acceptedPointCount: previous.acceptedPointCount ?? 1,
            ...DRIVER_SOURCE_META,
            samples: toRealtimeSamples(previous.samples ?? []),
          }
        : {
            lat: input.lat,
            lng: input.lng,
            speedKmh: 0,
            rawSpeedKmh,
            averageSpeedKmh: 0,
            displaySpeedKmh: 0,
            heading: input.heading ?? null,
            accuracyM,
            recordedAt: input.recordedAt.toISOString(),
            isStationary: true,
            distanceDeltaMeters: 0,
            elapsedSeconds: null,
            acceptedPointCount: 1,
            ...DRIVER_SOURCE_META,
            samples: [
              {
                lat: input.lat,
                lng: input.lng,
                speedKmh: 0,
                recordedAt: input.recordedAt.toISOString(),
              },
            ],
          };

    return {
      accepted: false,
      reason: "ACCURACY_REJECTED",
      state: fallbackState,
    };
  }

  if (!previous) {
    const initialObserved =
      accuracyM != null && accuracyM > freezeAccuracyThresholdM
        ? 0
        : rawSpeedKmh != null && rawSpeedKmh >= rawSpeedAssistMinKmh + 1
          ? round(rawSpeedKmh * 0.5, 1)
          : 0;

    return {
      accepted: true,
      state: {
        lat: input.lat,
        lng: input.lng,
        speedKmh: initialObserved,
        rawSpeedKmh,
        averageSpeedKmh: initialObserved,
        displaySpeedKmh: initialObserved,
        heading: input.heading ?? null,
        accuracyM,
        recordedAt: input.recordedAt.toISOString(),
        isStationary: initialObserved <= stationaryThresholdKmh,
        distanceDeltaMeters: null,
        elapsedSeconds: null,
        acceptedPointCount: 1,
        ...DRIVER_SOURCE_META,
        samples: [
          {
            lat: input.lat,
            lng: input.lng,
            speedKmh: initialObserved,
            recordedAt: input.recordedAt.toISOString(),
          },
        ],
      },
    };
  }

  const elapsedSecondsRaw =
    (input.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
  const elapsedSeconds = elapsedSecondsRaw > 0 ? elapsedSecondsRaw : 0.001;

  const rawDistanceMeters = haversineMeters(
    previous.lat,
    previous.lng,
    input.lat,
    input.lng,
  );

  const driftToleranceMeters = Math.max(
    minMovementDistanceM,
    accuracyM != null ? Math.min(accuracyM * 0.45, 14) : minMovementDistanceM,
  );

  const poorAccuracy = accuracyM != null && accuracyM > maxAcceptableAccuracyM;
  const weakAccuracy =
    accuracyM != null && accuracyM > freezeAccuracyThresholdM;

  const priorSamples = toRealtimeSamples(previous.samples ?? []);
  const recentSamples = [
    ...priorSamples,
    {
      lat: input.lat,
      lng: input.lng,
      speedKmh: 0,
      recordedAt: input.recordedAt.toISOString(),
    },
  ].filter(
    (sample) =>
      input.recordedAt.getTime() - new Date(sample.recordedAt).getTime() <=
      15000,
  );

  const recentDistanceMeters = computeRecentDistanceMeters(recentSamples);

  const serverDerivedSpeedKmh = clamp(
    (rawDistanceMeters / 1000 / elapsedSeconds) * 3600,
    0,
    Number(env.LOCATION_MAX_SERVER_SPEED_KMH ?? 120),
  );

  const previousWasStationary = Boolean(previous.isStationary);
  const looksStationaryByDistance = rawDistanceMeters <= driftToleranceMeters;
  const rawSpeedSuggestsMovement =
    rawSpeedKmh != null && rawSpeedKmh >= rawSpeedAssistMinKmh;
  const rawSpeedStronglySuggestsMovement =
    rawSpeedKmh != null && rawSpeedKmh >= stationaryReleaseSpeedKmh;

  const movementByDistance =
    rawDistanceMeters >= releaseMovementDistanceM &&
    elapsedSeconds >= minElapsedForMovementSeconds;

  const strongMovementByDistance =
    rawDistanceMeters >= confirmMovementDistanceM;

  const recentMovementConfirmed =
    recentDistanceMeters >= confirmMovementDistanceM &&
    elapsedSeconds >= minElapsedForMovementSeconds;

  const allowRawAssist =
    !weakAccuracy &&
    rawDistanceMeters >= significantMovementDistanceM &&
    elapsedSeconds >= minElapsedForMovementSeconds;

  const observedSpeedKmh = computeWeightedObservedSpeedKmh({
    serverDerivedSpeedKmh,
    rawSpeedKmh,
    accuracyConfidence,
    allowRawAssist,
  });

  const stationaryHold =
    previousWasStationary &&
    !rawSpeedStronglySuggestsMovement &&
    (rawDistanceMeters <= stationaryHoldDistanceM ||
      weakAccuracy ||
      elapsedSeconds < minElapsedForMovementSeconds);

  const movementConfidence =
    (strongMovementByDistance ? 0.45 : 0) +
    (recentMovementConfirmed ? 0.25 : 0) +
    (movementByDistance ? 0.18 : 0) +
    (rawSpeedSuggestsMovement ? 0.12 : 0);

  const movementConfirmed =
    !poorAccuracy &&
    !stationaryHold &&
    (strongMovementByDistance ||
      recentMovementConfirmed ||
      (movementByDistance &&
        (rawSpeedSuggestsMovement || observedSpeedKmh >= 5.5)) ||
      (previousWasStationary &&
        rawDistanceMeters >= stationaryExitDistanceM &&
        rawSpeedStronglySuggestsMovement));

  const freezeToPrevious =
    stationaryHold ||
    (poorAccuracy
      ? rawDistanceMeters <= driftToleranceMeters * 1.8
      : weakAccuracy
        ? rawDistanceMeters <= driftToleranceMeters * 1.35
        : looksStationaryByDistance);

  const isStationary = !movementConfirmed;

  const acceptedLat =
    freezeToPrevious || isStationary ? previous.lat : input.lat;

  const acceptedLng =
    freezeToPrevious || isStationary ? previous.lng : input.lng;

  const acceptedDistanceMeters = haversineMeters(
    previous.lat,
    previous.lng,
    acceptedLat,
    acceptedLng,
  );

  const currentSpeedKmh = computeCurrentSpeedKmh({
    observedSpeedKmh,
    rawSpeedKmh,
    accuracyConfidence,
    isStationary,
    movementConfidence: clamp(movementConfidence, 0, 1),
  });

  const nextSample: TripRealtimeSample = {
    lat: acceptedLat,
    lng: acceptedLng,
    speedKmh: currentSpeedKmh,
    recordedAt: input.recordedAt.toISOString(),
  };

  const keptSamples = [...priorSamples, nextSample].filter(
    (sample) =>
      input.recordedAt.getTime() - new Date(sample.recordedAt).getTime() <=
      rollingWindowMs,
  );

  const averageSpeedKmh = computeRollingAverageKmh(keptSamples, {
    minSegmentDistanceM: rollingAverageMinSegmentDistanceM,
    maxSegmentSpeedKmh: rollingAverageMaxSegmentSpeedKmh,
  });

  const targetDisplaySpeedKmh = isStationary
    ? 0
    : round(
        currentSpeedKmh * 0.65 + (averageSpeedKmh ?? currentSpeedKmh) * 0.35,
        1,
      );

  const strongBrake =
    previous.displaySpeedKmh != null &&
    targetDisplaySpeedKmh < previous.displaySpeedKmh * 0.55;

  const displaySpeedKmh = smoothDisplaySpeed({
    previousDisplaySpeedKmh: previous.displaySpeedKmh ?? previous.speedKmh ?? 0,
    targetSpeedKmh: targetDisplaySpeedKmh,
    elapsedSeconds,
    isStationary,
    strongBrake,
  });

  return {
    accepted: true,
    state: {
      lat: acceptedLat,
      lng: acceptedLng,
      speedKmh: currentSpeedKmh,
      rawSpeedKmh,
      averageSpeedKmh,
      displaySpeedKmh,
      heading: input.heading ?? previous.heading ?? null,
      accuracyM,
      recordedAt: input.recordedAt.toISOString(),
      isStationary,
      distanceDeltaMeters: round(acceptedDistanceMeters, 1),
      elapsedSeconds: round(elapsedSeconds, 1),
      acceptedPointCount: (previous.acceptedPointCount ?? 0) + 1,
      ...DRIVER_SOURCE_META,
      samples: keptSamples,
    },
  };
}
