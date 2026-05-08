import { haversineMeters, toNumber } from "../utils/geo.js";

export type StopPoint = {
  stopId: string;
  stopName: string;
  stopOrder: number;
  lat: unknown;
  lng: unknown;
};

export type EtaResult = {
  nearestStop: {
    stopId: string;
    stopName: string;
    stopOrder: number;
    distanceMeters: number;
  };
  nextStop: {
    stopId: string;
    stopName: string;
    stopOrder: number;
    distanceMeters: number;
  } | null;
  etaMinutes: number | null;
  usedSpeedKmh: number;
  rollingAverageSpeedKmh: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  finalStopReached: boolean;
};

type NormalizedStop = {
  stopId: string;
  stopName: string;
  stopOrder: number;
  lat: number;
  lng: number;
};

type StopDistance = { s: NormalizedStop; d: number };

type Point = {
  lat: number;
  lng: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toXYMeters(
  originLat: number,
  originLng: number,
  pointLat: number,
  pointLng: number,
) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.cos((originLat * Math.PI) / 180) * 111_320;

  return {
    x: (pointLng - originLng) * metersPerDegLng,
    y: (pointLat - originLat) * metersPerDegLat,
  };
}

function projectPointOntoSegmentMeters(params: {
  point: Point;
  start: Point;
  end: Point;
}) {
  const { point, start, end } = params;

  const localPoint = toXYMeters(start.lat, start.lng, point.lat, point.lng);
  const localEnd = toXYMeters(start.lat, start.lng, end.lat, end.lng);

  const segLenSq = localEnd.x * localEnd.x + localEnd.y * localEnd.y;

  if (segLenSq <= 0.000001) {
    return {
      t: 0,
      projectedLat: start.lat,
      projectedLng: start.lng,
      crossTrackDistanceMeters: haversineMeters(
        point.lat,
        point.lng,
        start.lat,
        start.lng,
      ),
    };
  }

  const rawT =
    (localPoint.x * localEnd.x + localPoint.y * localEnd.y) / segLenSq;
  const t = clamp(rawT, 0, 1);

  const projectedX = localEnd.x * t;
  const projectedY = localEnd.y * t;

  const projectedLat = start.lat + projectedY / 111_320;
  const projectedLng =
    start.lng + projectedX / (Math.cos((start.lat * Math.PI) / 180) * 111_320);

  const crossTrackDistanceMeters = haversineMeters(
    point.lat,
    point.lng,
    projectedLat,
    projectedLng,
  );

  return {
    t,
    projectedLat,
    projectedLng,
    crossTrackDistanceMeters,
  };
}

function buildNormalizedStops(stops: StopPoint[]) {
  return [...stops]
    .map((stop) => ({
      stopId: stop.stopId,
      stopName: stop.stopName,
      stopOrder: stop.stopOrder,
      lat: toNumber(stop.lat),
      lng: toNumber(stop.lng),
    }))
    .filter((stop) => {
      return (
        Number.isFinite(stop.lat) &&
        Number.isFinite(stop.lng) &&
        stop.lat >= -90 &&
        stop.lat <= 90 &&
        stop.lng >= -180 &&
        stop.lng <= 180
      );
    })
    .sort((a, b) => a.stopOrder - b.stopOrder);
}

function buildCumulativeDistances(stops: NormalizedStop[]) {
  const cumulative: number[] = [0];

  for (let i = 1; i < stops.length; i += 1) {
    const prev = stops[i - 1];
    const curr = stops[i];

    const distance = haversineMeters(
      prev!.lat,
      prev!.lng,
      curr!.lat,
      curr!.lng,
    );
    cumulative.push(cumulative[i - 1]! + distance);
  }

  return cumulative;
}

function getNearestStopDistances(
  stops: NormalizedStop[],
  currentLat: number,
  currentLng: number,
): StopDistance[] {
  return stops
    .map((s) => ({
      s,
      d: haversineMeters(currentLat, currentLng, s.lat, s.lng),
    }))
    .sort((a, b) => a.d - b.d);
}

function estimateRouteProgressMeters(params: {
  stops: NormalizedStop[];
  cumulative: number[];
  currentLat: number;
  currentLng: number;
}) {
  const { stops, cumulative, currentLat, currentLng } = params;

  if (stops.length === 1) {
    return {
      progressMeters: 0,
      segmentStartIndex: 0,
      segmentEndIndex: 0,
      crossTrackDistanceMeters: haversineMeters(
        currentLat,
        currentLng,
        stops[0]!.lat,
        stops[0]!.lng,
      ),
    };
  }

  let best: {
    progressMeters: number;
    segmentStartIndex: number;
    segmentEndIndex: number;
    crossTrackDistanceMeters: number;
  } | null = null;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const start = stops[i]!;
    const end = stops[i + 1]!;

    const segmentLengthMeters = haversineMeters(
      start.lat,
      start.lng,
      end.lat,
      end.lng,
    );

    if (segmentLengthMeters <= 0.000001) continue;

    const projection = projectPointOntoSegmentMeters({
      point: { lat: currentLat, lng: currentLng },
      start: { lat: start.lat, lng: start.lng },
      end: { lat: end.lat, lng: end.lng },
    });

    const progressMeters = cumulative[i]! + segmentLengthMeters * projection.t;

    if (
      !best ||
      projection.crossTrackDistanceMeters < best.crossTrackDistanceMeters
    ) {
      best = {
        progressMeters,
        segmentStartIndex: i,
        segmentEndIndex: i + 1,
        crossTrackDistanceMeters: projection.crossTrackDistanceMeters,
      };
    }
  }

  return (
    best ?? {
      progressMeters: 0,
      segmentStartIndex: 0,
      segmentEndIndex: Math.min(1, stops.length - 1),
      crossTrackDistanceMeters: 0,
    }
  );
}

function getTrustedSpeed(params: {
  lastSpeedKmh: number | null | undefined;
  rollingAverageSpeedKmh: number | null | undefined;
  defaultSpeedKmh: number;
}) {
  const { lastSpeedKmh, rollingAverageSpeedKmh, defaultSpeedKmh } = params;

  const trustedRollingSpeed =
    typeof rollingAverageSpeedKmh === "number" &&
    Number.isFinite(rollingAverageSpeedKmh) &&
    rollingAverageSpeedKmh >= 5
      ? rollingAverageSpeedKmh
      : null;

  const trustedLiveSpeed =
    typeof lastSpeedKmh === "number" &&
    Number.isFinite(lastSpeedKmh) &&
    lastSpeedKmh >= 4
      ? lastSpeedKmh
      : null;

  const speed = trustedRollingSpeed ?? trustedLiveSpeed ?? defaultSpeedKmh;

  let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  if (trustedRollingSpeed != null && trustedRollingSpeed >= 8) {
    confidence = "HIGH";
  } else if (trustedLiveSpeed != null && trustedLiveSpeed >= 6) {
    confidence = "MEDIUM";
  }

  return {
    speed,
    confidence,
    trustedRollingSpeed,
  };
}

export function computeNextStopAndEta(opts: {
  currentLat: number;
  currentLng: number;
  stops: StopPoint[];
  lastSpeedKmh?: number | null;
  rollingAverageSpeedKmh?: number | null;
  arrivalRadiusMeters?: number;
  defaultSpeedKmh?: number;
  lastArrivedStopId?: string | null;
}): EtaResult | null {
  const {
    currentLat,
    currentLng,
    stops,
    lastSpeedKmh,
    rollingAverageSpeedKmh,
    arrivalRadiusMeters = 80,
    defaultSpeedKmh = 20,
    lastArrivedStopId = null,
  } = opts;

  if (stops.length === 0) return null;

  const orderedStops = buildNormalizedStops(stops);
  if (orderedStops.length === 0) return null;

  const nearestDistances = getNearestStopDistances(
    orderedStops,
    currentLat,
    currentLng,
  );

  const nearest = nearestDistances[0];
  if (!nearest) return null;

  const cumulative = buildCumulativeDistances(orderedStops);
  const routeTotalMeters = cumulative[cumulative.length - 1] ?? 0;

  const progress = estimateRouteProgressMeters({
    stops: orderedStops,
    cumulative,
    currentLat,
    currentLng,
  });

  const nearestIndex = orderedStops.findIndex(
    (stop) => stop.stopId === nearest.s.stopId,
  );

  const lastArrivedIndex =
    lastArrivedStopId != null
      ? orderedStops.findIndex((stop) => stop.stopId === lastArrivedStopId)
      : -1;

  const atNearestStop = nearest.d <= arrivalRadiusMeters;
  const nearestIsFinal = nearestIndex === orderedStops.length - 1;
  const arrivalLockedFinal =
    lastArrivedIndex >= 0 && lastArrivedIndex === orderedStops.length - 1;

  const speedInfo = getTrustedSpeed({
    lastSpeedKmh,
    rollingAverageSpeedKmh,
    defaultSpeedKmh,
  });

  if (arrivalLockedFinal) {
    return {
      nearestStop: {
        stopId: nearest.s.stopId,
        stopName: nearest.s.stopName,
        stopOrder: nearest.s.stopOrder,
        distanceMeters: Math.round(nearest.d),
      },
      nextStop: null,
      etaMinutes: null,
      usedSpeedKmh: Number(speedInfo.speed.toFixed(2)),
      rollingAverageSpeedKmh:
        speedInfo.trustedRollingSpeed != null
          ? Number(speedInfo.trustedRollingSpeed.toFixed(2))
          : null,
      confidence: speedInfo.confidence,
      finalStopReached: true,
    };
  }

  const minimumAllowedNextStopIndex =
    lastArrivedIndex >= 0 ? lastArrivedIndex + 1 : 0;

  let nextStopIndex: number | null = null;

  if (atNearestStop) {
    if (nearestIndex < minimumAllowedNextStopIndex) {
      nextStopIndex =
        minimumAllowedNextStopIndex < orderedStops.length
          ? minimumAllowedNextStopIndex
          : null;
    } else if (nearestIsFinal) {
      nextStopIndex = null;
    } else {
      nextStopIndex = nearestIndex + 1;
    }
  } else {
    const routeProgressBufferMeters = Math.max(3, arrivalRadiusMeters * 0.15);

    const projectedCandidateIndex = orderedStops.findIndex(
      (_, idx) =>
        cumulative[idx]! > progress.progressMeters + routeProgressBufferMeters,
    );

    let candidateIndex =
      projectedCandidateIndex >= 0
        ? projectedCandidateIndex
        : orderedStops.length - 1;

    if (candidateIndex <= progress.segmentStartIndex) {
      candidateIndex = progress.segmentEndIndex;
    }

    if (candidateIndex < minimumAllowedNextStopIndex) {
      candidateIndex = minimumAllowedNextStopIndex;
    }

    nextStopIndex =
      candidateIndex < orderedStops.length ? candidateIndex : null;
  }

  const finalStopReached =
    nextStopIndex == null &&
    ((atNearestStop && nearestIsFinal) ||
      progress.progressMeters >= routeTotalMeters - arrivalRadiusMeters * 0.5);

  const next =
    nextStopIndex != null
      ? (() => {
          const stop = orderedStops[nextStopIndex]!;
          const stopProgressMeters =
            cumulative[nextStopIndex] ?? routeTotalMeters;

          const routeRemainingMeters = Math.max(
            0,
            stopProgressMeters - progress.progressMeters,
          );

          const directDistanceMeters = haversineMeters(
            currentLat,
            currentLng,
            stop.lat,
            stop.lng,
          );

          const distanceMeters = Math.max(
            Math.min(routeRemainingMeters, directDistanceMeters),
            directDistanceMeters <= arrivalRadiusMeters
              ? directDistanceMeters
              : 0,
          );

          return {
            stopId: stop.stopId,
            stopName: stop.stopName,
            stopOrder: stop.stopOrder,
            distanceMeters: Math.round(distanceMeters),
          };
        })()
      : null;

  const etaMinutes =
    next && speedInfo.speed > 0
      ? Math.max(
          1,
          Math.round((next.distanceMeters / 1000 / speedInfo.speed) * 60),
        )
      : null;

  return {
    nearestStop: {
      stopId: nearest.s.stopId,
      stopName: nearest.s.stopName,
      stopOrder: nearest.s.stopOrder,
      distanceMeters: Math.round(nearest.d),
    },
    nextStop: next,
    etaMinutes: finalStopReached ? null : etaMinutes,
    usedSpeedKmh: Number(speedInfo.speed.toFixed(2)),
    rollingAverageSpeedKmh:
      speedInfo.trustedRollingSpeed != null
        ? Number(speedInfo.trustedRollingSpeed.toFixed(2))
        : null,
    confidence: speedInfo.confidence,
    finalStopReached,
  };
}
