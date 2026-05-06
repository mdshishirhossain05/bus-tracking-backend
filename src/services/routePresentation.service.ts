import { prisma } from "../config/prisma.js";

function toNumber(value: unknown) {
  if (value == null) return null;

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeGeometryPoint(point: any): [number, number] | null {
  if (Array.isArray(point) && point.length >= 2) {
    const lat = toNumber(point[0]);
    const lng = toNumber(point[1]);

    if (lat == null || lng == null) return null;
    return [lat, lng];
  }

  const lat = toNumber(point?.lat ?? point?.latitude);
  const lng = toNumber(point?.lng ?? point?.longitude);

  if (lat == null || lng == null) return null;
  return [lat, lng];
}

function normalizeGeometry(polyline: unknown): [number, number][] {
  if (!Array.isArray(polyline)) return [];

  return polyline
    .map(normalizeGeometryPoint)
    .filter((point): point is [number, number] => point != null);
}

function durationSecondsToMinutes(value: number | null) {
  if (value == null) return null;
  return Number((value / 60).toFixed(1));
}

export async function getRoutePresentationService(routeId: string) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      routeStops: {
        orderBy: { stopOrder: "asc" },
        include: {
          stop: true,
        },
      },
      geometry: true,
    },
  });

  if (!route) {
    return null;
  }

  const stops = route.routeStops.map((item) => ({
    id: item.stop.id,
    stopId: item.stop.id,
    name: item.stop.stopName,
    stopName: item.stop.stopName,
    latitude: Number(item.stop.lat),
    longitude: Number(item.stop.lng),
    lat: Number(item.stop.lat),
    lng: Number(item.stop.lng),
    order: item.stopOrder,
    stopOrder: item.stopOrder,
    distanceFromStartKm: toNumber(item.distanceFromStartKm),
  }));

  const polyline = normalizeGeometry(route.geometry?.polyline);

  const origin = stops[0] ?? null;
  const destination = stops.length > 0 ? stops[stops.length - 1] : null;

  const distanceKm =
    toNumber(route.geometry?.distanceKm) ??
    stops
      .map((stop) => toNumber(stop.distanceFromStartKm))
      .filter((value): value is number => value != null)
      .at(-1) ??
    null;

  const durationSeconds =
    typeof route.geometry?.durationSeconds === "number"
      ? route.geometry.durationSeconds
      : null;

  return {
    routeId: route.id,
    id: route.id,
    routeName: route.routeName,
    name: route.routeName,
    polyline,
    geometry: {
      polyline,
      distanceKm,
      durationSeconds,
      durationMinutes: durationSecondsToMinutes(durationSeconds),
      source:
        typeof route.geometry?.source === "string"
          ? route.geometry.source
          : polyline.length >= 2
            ? "SAVED_GEOMETRY"
            : "UNKNOWN",
    },
    stops,
    origin,
    destination,
    summary: {
      distanceKm,
      durationSeconds,
      durationMinutes: durationSecondsToMinutes(durationSeconds),
      source:
        typeof route.geometry?.source === "string"
          ? route.geometry.source
          : polyline.length >= 2
            ? "SAVED_GEOMETRY"
            : "UNKNOWN",
    },
  };
}
