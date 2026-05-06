import { env } from "../config/env.js";

export type LatLng = {
  lat: number;
  lng: number;
};

export type RouteMetrics = {
  distancesKm: number[];
  geometry: LatLng[];
  durationSeconds: number | null;
  routingMode: "google_routes" | "fallback" | "none";
};

type GoogleRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: {
      encodedPolyline?: string;
    };
    legs?: Array<{
      distanceMeters?: number;
      duration?: string;
    }>;
  }>;
};

function roundCoord(value: number) {
  return Number(value.toFixed(7));
}

function roundKm(value: number) {
  return Number(value.toFixed(3));
}

function parseGoogleDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;

  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

function haversineMeters(a: LatLng, b: LatLng) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function decodeGoogleEncodedPolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];

  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({
      lat: roundCoord(lat / 1e5),
      lng: roundCoord(lng / 1e5),
    });
  }

  return points;
}

function buildFallbackRouteMetrics(stops: LatLng[]): RouteMetrics {
  if (stops.length === 0) {
    return {
      distancesKm: [],
      geometry: [],
      durationSeconds: null,
      routingMode: "none",
    };
  }

  if (stops.length === 1) {
    return {
      distancesKm: [0],
      geometry: stops,
      durationSeconds: null,
      routingMode: "fallback",
    };
  }

  const distancesKm: number[] = [0];
  const geometry: LatLng[] = [stops[0]!];

  let totalKm = 0;

  for (let i = 1; i < stops.length; i += 1) {
    const previous = stops[i - 1]!;
    const current = stops[i]!;

    totalKm += haversineMeters(previous, current) / 1000;
    distancesKm.push(roundKm(totalKm));
    geometry.push({
      lat: current.lat,
      lng: current.lng,
    });
  }

  return {
    distancesKm,
    geometry,
    durationSeconds: null,
    routingMode: "fallback",
  };
}

function buildCumulativeDistancesFromLegs(
  stops: LatLng[],
  routeDistanceMeters: number | null,
  legs: Array<{ distanceMeters?: number }> | undefined,
) {
  if (!Array.isArray(legs) || legs.length !== stops.length - 1) {
    if (routeDistanceMeters == null || stops.length < 2) {
      return null;
    }

    const fallback = buildFallbackRouteMetrics(stops);
    const fallbackTotalKm = fallback.distancesKm.at(-1) ?? 0;
    const routeTotalKm = routeDistanceMeters / 1000;

    if (fallbackTotalKm <= 0) {
      return stops.map((_, index) => (index === 0 ? 0 : roundKm(routeTotalKm)));
    }

    return fallback.distancesKm.map((distanceKm) =>
      roundKm((distanceKm / fallbackTotalKm) * routeTotalKm),
    );
  }

  const distancesKm: number[] = [0];
  let totalKm = 0;

  for (const leg of legs) {
    const distanceMeters = Number(leg.distanceMeters ?? 0);
    totalKm += Number.isFinite(distanceMeters) ? distanceMeters / 1000 : 0;
    distancesKm.push(roundKm(totalKm));
  }

  return distancesKm;
}

async function fetchGoogleRouteMetrics(stops: LatLng[]): Promise<RouteMetrics> {
  const apiKey = env.GOOGLE_MAPS_SERVER_API_KEY.trim();

  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_SERVER_API_KEY is not configured.");
  }

  if (stops.length < 2) {
    return buildFallbackRouteMetrics(stops);
  }

  /*
   * Google Routes supports intermediate waypoints, but we keep this conservative.
   * origin + destination + 25 intermediate waypoints = 27 route points.
   */
  if (stops.length > 27) {
    throw new Error(
      "Too many stops for a single Google Routes request. Split the route or reduce stops.",
    );
  }

  const [origin, ...rest] = stops;
  const destination = rest.at(-1);
  const intermediates = rest.slice(0, -1);

  if (!origin || !destination) {
    return buildFallbackRouteMetrics(stops);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.GOOGLE_ROUTES_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration",
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: origin.lat,
                longitude: origin.lng,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: destination.lat,
                longitude: destination.lng,
              },
            },
          },
          intermediates: intermediates.map((point) => ({
            location: {
              latLng: {
                latitude: point.lat,
                longitude: point.lng,
              },
            },
          })),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
          computeAlternativeRoutes: false,
          polylineQuality: "HIGH_QUALITY",
          polylineEncoding: "ENCODED_POLYLINE",
          units: "METRIC",
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Google Routes API failed with ${response.status}. ${body}`.trim(),
      );
    }

    const data = (await response.json()) as GoogleRoutesResponse;
    const route = data.routes?.[0];

    if (!route) {
      throw new Error("Google Routes API did not return a route.");
    }

    const encodedPolyline = route.polyline?.encodedPolyline;
    const geometry = encodedPolyline
      ? decodeGoogleEncodedPolyline(encodedPolyline)
      : [];

    const routeDistanceMeters =
      route.distanceMeters == null ? null : Number(route.distanceMeters);

    const distancesKm = buildCumulativeDistancesFromLegs(
      stops,
      routeDistanceMeters,
      route.legs,
    );

    if (!distancesKm || distancesKm.length !== stops.length) {
      throw new Error("Google Routes API returned incomplete leg distances.");
    }

    const durationSeconds =
      parseGoogleDurationSeconds(route.duration) ??
      route.legs?.reduce((total, leg) => {
        const seconds = parseGoogleDurationSeconds(leg.duration);
        return total + (seconds ?? 0);
      }, 0) ??
      null;

    return {
      distancesKm,
      geometry:
        geometry.length >= 2
          ? geometry
          : stops.map((point) => ({
              lat: point.lat,
              lng: point.lng,
            })),
      durationSeconds,
      routingMode: "google_routes",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildRouteMetrics(
  stops: LatLng[],
): Promise<RouteMetrics> {
  if (stops.length === 0) {
    return {
      distancesKm: [],
      geometry: [],
      durationSeconds: null,
      routingMode: "none",
    };
  }

  if (stops.length === 1) {
    return buildFallbackRouteMetrics(stops);
  }

  try {
    return await fetchGoogleRouteMetrics(stops);
  } catch (error) {
    console.warn("Google Routes unavailable; using straight-line fallback:", {
      error: error instanceof Error ? error.message : String(error),
    });

    return buildFallbackRouteMetrics(stops);
  }
}
