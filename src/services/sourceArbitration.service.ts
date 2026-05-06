import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import {
  clearTripRealtimeState,
  getTripLastGoodRealtimeState,
  getTripSourceRealtimeState,
  getTripRealtimeState,
  setTripLastGoodRealtimeState,
  setTripRealtimeState,
  type TripRealtimeSelectionReason,
  type TripRealtimeSourceStatus,
  type TripRealtimeSourceType,
  type TripRealtimeState,
} from "./tripRealtimeState.service.js";

type SelectedSourceCandidate = {
  sourceType: TripRealtimeSourceType;
  sourceStatus: TripRealtimeSourceStatus;
  selectionReason: TripRealtimeSelectionReason;
  sourceLabel: string | null;
  recordedAt: Date;
  lat: number;
  lng: number;
  speedKmh: number | null;
  rawSpeedKmh: number | null;
  averageSpeedKmh: number | null;
  displaySpeedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  isStationary: boolean;
  distanceDeltaMeters: number | null;
  elapsedSeconds: number | null;
  acceptedPointCount: number;
  samples: Array<{
    lat: number;
    lng: number;
    speedKmh: number;
    recordedAt: Date;
  }>;
};

type DbTrackingSelectionReason =
  | "DRIVER_ONLY"
  | "GPS_ONLY"
  | "GPS_PRIORITY"
  | "DRIVER_PRIORITY"
  | "GPS_FALLBACK_TO_DRIVER"
  | "DRIVER_FALLBACK_TO_GPS"
  | "MOST_RECENT_HEALTHY"
  | "NO_HEALTHY_SOURCE";

function asNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) return null;
  return Number(String(value));
}

function buildCanonicalState(
  candidate: SelectedSourceCandidate,
): TripRealtimeState {
  return {
    lat: candidate.lat,
    lng: candidate.lng,
    speedKmh: candidate.speedKmh,
    rawSpeedKmh: candidate.rawSpeedKmh,
    averageSpeedKmh: candidate.averageSpeedKmh,
    displaySpeedKmh: candidate.displaySpeedKmh,
    heading: candidate.heading,
    accuracyM: candidate.accuracyM,
    recordedAt: candidate.recordedAt.toISOString(),
    isStationary: candidate.isStationary,
    distanceDeltaMeters: candidate.distanceDeltaMeters,
    elapsedSeconds: candidate.elapsedSeconds,
    acceptedPointCount: candidate.acceptedPointCount,
    sourceType: candidate.sourceType,
    sourceStatus: candidate.sourceStatus,
    selectionReason: candidate.selectionReason,
    sourceLabel: candidate.sourceLabel,
    samples: candidate.samples.map((sample) => ({
      lat: sample.lat,
      lng: sample.lng,
      speedKmh: sample.speedKmh,
      recordedAt: sample.recordedAt.toISOString(),
    })),
  };
}

function secondsSince(date: Date | null | undefined) {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - date.getTime()) / 1000);
}

function deriveSourceStatus(
  recordedAt: Date | null,
  staleAfterSeconds: number,
  unhealthyAfterSeconds: number,
): TripRealtimeSourceStatus {
  if (!recordedAt) return "DISCONNECTED";

  const ageSeconds = secondsSince(recordedAt);

  if (ageSeconds > unhealthyAfterSeconds) return "DISCONNECTED";
  if (ageSeconds > staleAfterSeconds) return "STALE";
  return "HEALTHY";
}

function driverCandidateFromRedis(
  state: Awaited<ReturnType<typeof getTripSourceRealtimeState>>,
  staleAfterSeconds: number,
  unhealthyAfterSeconds: number,
): SelectedSourceCandidate | null {
  if (!state) return null;

  const status = deriveSourceStatus(
    state.recordedAt,
    staleAfterSeconds,
    unhealthyAfterSeconds,
  );

  return {
    sourceType: "DRIVER_MOBILE",
    sourceStatus: status,
    selectionReason: "DRIVER_ONLY",
    sourceLabel: state.sourceLabel ?? "Driver Mobile",
    recordedAt: state.recordedAt,
    lat: state.lat,
    lng: state.lng,
    speedKmh: state.speedKmh,
    rawSpeedKmh: state.rawSpeedKmh,
    averageSpeedKmh: state.averageSpeedKmh,
    displaySpeedKmh: state.displaySpeedKmh,
    heading: state.heading,
    accuracyM: state.accuracyM,
    isStationary: state.isStationary,
    distanceDeltaMeters: state.distanceDeltaMeters,
    elapsedSeconds: state.elapsedSeconds,
    acceptedPointCount: state.acceptedPointCount,
    samples: state.samples,
  };
}

function gpsCandidateFromDb(
  sourceState: {
    sourceStatus: "HEALTHY" | "STALE" | "UNHEALTHY" | "DISCONNECTED";
    sourceLabel: string | null;
    recordedAt: Date | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    speedKmh: Prisma.Decimal | null;
    rawSpeedKmh: Prisma.Decimal | null;
    averageSpeedKmh: Prisma.Decimal | null;
    displaySpeedKmh: Prisma.Decimal | null;
    heading: number | null;
    accuracyM: Prisma.Decimal | null;
  } | null,
  staleAfterSeconds: number,
  unhealthyAfterSeconds: number,
): SelectedSourceCandidate | null {
  if (
    !sourceState ||
    sourceState.recordedAt == null ||
    sourceState.latitude == null ||
    sourceState.longitude == null
  ) {
    return null;
  }

  const freshnessStatus = deriveSourceStatus(
    sourceState.recordedAt,
    staleAfterSeconds,
    unhealthyAfterSeconds,
  );

  const sourceStatus =
    sourceState.sourceStatus === "UNHEALTHY" ||
    sourceState.sourceStatus === "DISCONNECTED"
      ? sourceState.sourceStatus
      : freshnessStatus;

  return {
    sourceType: "GPS_DEVICE",
    sourceStatus,
    selectionReason: "GPS_ONLY",
    sourceLabel: sourceState.sourceLabel ?? "GPS Device",
    recordedAt: sourceState.recordedAt,
    lat: Number(sourceState.latitude),
    lng: Number(sourceState.longitude),
    speedKmh: asNumber(sourceState.speedKmh),
    rawSpeedKmh: asNumber(sourceState.rawSpeedKmh),
    averageSpeedKmh: asNumber(sourceState.averageSpeedKmh),
    displaySpeedKmh:
      asNumber(sourceState.displaySpeedKmh) ?? asNumber(sourceState.speedKmh),
    heading: sourceState.heading,
    accuracyM: asNumber(sourceState.accuracyM),
    isStationary:
      (asNumber(sourceState.displaySpeedKmh) ??
        asNumber(sourceState.speedKmh) ??
        0) <= 4,
    distanceDeltaMeters: null,
    elapsedSeconds: null,
    acceptedPointCount: 1,
    samples: [],
  };
}

function winnerScore(candidate: SelectedSourceCandidate) {
  const statusScore =
    candidate.sourceStatus === "HEALTHY"
      ? 1000
      : candidate.sourceStatus === "STALE"
        ? 600
        : candidate.sourceStatus === "UNHEALTHY"
          ? 200
          : 0;

  const freshnessBonus = Math.max(0, 120 - secondsSince(candidate.recordedAt));
  const gpsBias = candidate.sourceType === "GPS_DEVICE" ? 15 : 0;

  return statusScore + freshnessBonus + gpsBias;
}

function mapSelectionReasonToDb(
  reason: TripRealtimeSelectionReason,
): DbTrackingSelectionReason {
  switch (reason) {
    case "STICKY_PREVIOUS_SOURCE":
      return "MOST_RECENT_HEALTHY";
    case "HOLD_LAST_GOOD_STATE":
      return "MOST_RECENT_HEALTHY";
    default:
      return reason;
  }
}

function canKeepPreviousSource(params: {
  previous: Awaited<ReturnType<typeof getTripRealtimeState>>;
  driver: SelectedSourceCandidate | null;
  gps: SelectedSourceCandidate | null;
  hysteresisGap: number;
  stickyWindowSeconds: number;
}) {
  const { previous, driver, gps, hysteresisGap, stickyWindowSeconds } = params;
  if (!previous?.sourceType) return false;

  const previousCandidate = previous.sourceType === "GPS_DEVICE" ? gps : driver;
  const otherCandidate = previous.sourceType === "GPS_DEVICE" ? driver : gps;

  if (!previousCandidate) return false;
  if (secondsSince(previousCandidate.recordedAt) > stickyWindowSeconds) {
    return false;
  }
  if (previousCandidate.sourceStatus === "DISCONNECTED") return false;

  const previousScore = winnerScore(previousCandidate);
  const otherScore = otherCandidate ? winnerScore(otherCandidate) : -1;

  return previousScore + hysteresisGap >= otherScore;
}

function chooseWinner(params: {
  previous: Awaited<ReturnType<typeof getTripRealtimeState>>;
  driver: SelectedSourceCandidate | null;
  gps: SelectedSourceCandidate | null;
  hysteresisGap: number;
  stickyWindowSeconds: number;
}) {
  const { previous, driver, gps, hysteresisGap, stickyWindowSeconds } = params;

  if (
    canKeepPreviousSource({
      previous,
      driver,
      gps,
      hysteresisGap,
      stickyWindowSeconds,
    })
  ) {
    const kept = previous?.sourceType === "GPS_DEVICE" ? gps : driver;
    if (kept) {
      return {
        ...kept,
        selectionReason: "STICKY_PREVIOUS_SOURCE" as const,
      };
    }
  }

  const candidates = [gps, driver].filter(Boolean) as SelectedSourceCandidate[];
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => winnerScore(b) - winnerScore(a));
  const best = candidates[0];
  const second = candidates[1] ?? null;

  if (!best) return null;

  if (best.sourceType === "GPS_DEVICE" && best.sourceStatus === "HEALTHY") {
    return {
      ...best,
      selectionReason:
        driver?.sourceStatus === "HEALTHY"
          ? ("GPS_PRIORITY" as const)
          : ("DRIVER_FALLBACK_TO_GPS" as const),
    };
  }

  if (best.sourceType === "DRIVER_MOBILE" && best.sourceStatus === "HEALTHY") {
    return {
      ...best,
      selectionReason:
        gps?.sourceStatus === "HEALTHY"
          ? ("DRIVER_PRIORITY" as const)
          : ("GPS_FALLBACK_TO_DRIVER" as const),
    };
  }

  if (!second) {
    return {
      ...best,
      selectionReason:
        best.sourceType === "GPS_DEVICE"
          ? ("GPS_ONLY" as const)
          : ("DRIVER_ONLY" as const),
    };
  }

  return {
    ...best,
    selectionReason: "MOST_RECENT_HEALTHY" as const,
  };
}

export async function arbitrateTripTrackingSource(params: {
  tripId: string;
  busId: string;
}) {
  const { tripId, busId } = params;

  const driverStaleAfterSeconds = Number(
    env.DRIVER_SOURCE_STALE_AFTER_SECONDS ?? 35,
  );
  const driverDisconnectAfterSeconds = Number(
    env.DRIVER_SOURCE_DISCONNECT_AFTER_SECONDS ?? 90,
  );
  const gpsStaleAfterSeconds = Number(env.GPS_DEVICE_STALE_AFTER_SECONDS ?? 90);
  const gpsDisconnectAfterSeconds = Number(
    env.GPS_DEVICE_DISCONNECT_AFTER_SECONDS ?? 180,
  );
  const hysteresisGap = Number(env.TRACKING_SOURCE_HYSTERESIS_SCORE_GAP ?? 25);
  const stickyWindowSeconds = Number(
    env.TRACKING_SOURCE_STICKY_WINDOW_SECONDS ?? 45,
  );
  const lastGoodHoldSeconds = Number(
    env.TRACKING_LAST_GOOD_HOLD_SECONDS ?? 120,
  );

  const [previousSelected, lastGood, driverState, gpsSourceState] =
    await Promise.all([
      getTripRealtimeState(tripId),
      getTripLastGoodRealtimeState(tripId),
      getTripSourceRealtimeState(tripId, "DRIVER_MOBILE"),
      prisma.sourceTrackingState.findUnique({
        where: {
          busId_sourceType: {
            busId,
            sourceType: "GPS_DEVICE",
          },
        },
        select: {
          sourceStatus: true,
          sourceLabel: true,
          recordedAt: true,
          latitude: true,
          longitude: true,
          speedKmh: true,
          rawSpeedKmh: true,
          averageSpeedKmh: true,
          displaySpeedKmh: true,
          heading: true,
          accuracyM: true,
          tripId: true,
        },
      }),
    ]);

  const driverCandidate = driverCandidateFromRedis(
    driverState,
    driverStaleAfterSeconds,
    driverDisconnectAfterSeconds,
  );

  const gpsCandidate =
    gpsSourceState &&
    (!gpsSourceState.tripId || gpsSourceState.tripId === tripId)
      ? gpsCandidateFromDb(
          gpsSourceState,
          gpsStaleAfterSeconds,
          gpsDisconnectAfterSeconds,
        )
      : null;

  const selected = chooseWinner({
    previous: previousSelected,
    driver: driverCandidate,
    gps: gpsCandidate,
    hysteresisGap,
    stickyWindowSeconds,
  });

  let canonicalState: TripRealtimeState | null = null;

  if (selected) {
    canonicalState = buildCanonicalState(selected);

    if (
      selected.sourceStatus === "HEALTHY" ||
      selected.sourceStatus === "STALE"
    ) {
      await setTripLastGoodRealtimeState(tripId, canonicalState);
    }
  } else if (
    lastGood &&
    secondsSince(lastGood.recordedAt) <= lastGoodHoldSeconds
  ) {
    const heldCandidate: SelectedSourceCandidate = {
      sourceType: lastGood.sourceType,
      sourceStatus: "STALE",
      selectionReason: "HOLD_LAST_GOOD_STATE",
      sourceLabel: lastGood.sourceLabel,
      recordedAt: lastGood.recordedAt,
      lat: lastGood.lat,
      lng: lastGood.lng,
      speedKmh: lastGood.speedKmh,
      rawSpeedKmh: lastGood.rawSpeedKmh,
      averageSpeedKmh: lastGood.averageSpeedKmh,
      displaySpeedKmh: lastGood.displaySpeedKmh,
      heading: lastGood.heading,
      accuracyM: lastGood.accuracyM,
      isStationary: lastGood.isStationary,
      distanceDeltaMeters: lastGood.distanceDeltaMeters,
      elapsedSeconds: lastGood.elapsedSeconds,
      acceptedPointCount: lastGood.acceptedPointCount,
      samples: lastGood.samples,
    };

    canonicalState = buildCanonicalState(heldCandidate);
  }

  if (!canonicalState) {
    await clearTripRealtimeState(tripId);

    await prisma.trip.update({
      where: { id: tripId },
      data: {
        isStale: true,
        lastTrackingSourceStatus: "STALE",
        lastTrackingSelectionReason: "NO_HEALTHY_SOURCE",
      },
    });

    await prisma.sourceTrackingState.updateMany({
      where: {
        busId,
        tripId,
      },
      data: {
        isSelected: false,
      },
    });

    return null;
  }

  await setTripRealtimeState(tripId, canonicalState);

  await prisma.$transaction(async (tx) => {
    await tx.trip.update({
      where: { id: tripId },
      data: {
        lastLatitude: new Prisma.Decimal(canonicalState.lat),
        lastLongitude: new Prisma.Decimal(canonicalState.lng),
        lastSpeedKmh:
          canonicalState.displaySpeedKmh != null
            ? new Prisma.Decimal(canonicalState.displaySpeedKmh)
            : null,
        lastHeading: canonicalState.heading,
        lastAccuracyM:
          canonicalState.accuracyM != null
            ? new Prisma.Decimal(canonicalState.accuracyM)
            : null,
        lastLocationAt: new Date(canonicalState.recordedAt),
        isStale: canonicalState.sourceStatus !== "HEALTHY",
        lastTrackingSourceType: canonicalState.sourceType,
        lastTrackingSourceStatus: canonicalState.sourceStatus,
        lastTrackingSelectionReason: mapSelectionReasonToDb(
          canonicalState.selectionReason,
        ),
        lastTrackingSourceLabel: canonicalState.sourceLabel,
        lastTrackingSourceRecordedAt: new Date(canonicalState.recordedAt),
      },
    });

    await tx.sourceTrackingState.updateMany({
      where: {
        busId,
        tripId,
      },
      data: {
        isSelected: false,
      },
    });

    await tx.sourceTrackingState.updateMany({
      where: {
        busId,
        tripId,
        sourceType: canonicalState.sourceType,
      },
      data: {
        isSelected: true,
        sourceStatus: canonicalState.sourceStatus,
        sourceLabel: canonicalState.sourceLabel,
      },
    });
  });

  return canonicalState;
}
