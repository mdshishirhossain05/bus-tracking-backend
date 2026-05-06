import { prisma } from "../config/prisma.js";
import { redis } from "../config/redis.js";
import { toNumber } from "../utils/geo.js";
import { env } from "../config/env.js";

export type CachedStop = {
  stopId: string;
  stopName: string;
  stopOrder: number;
  lat: number;
  lng: number;
};

const STOPS_TTL_SECONDS = Number(env.STOPS_CACHE_TTL_SECONDS ?? 300);

function routeVersionKey(routeId: string) {
  return `routeStops:version:${routeId}`;
}

function routeStopsKey(routeId: string, version: number) {
  return `routeStops:data:${routeId}:v${version}`;
}

async function getRouteVersion(routeId: string): Promise<number> {
  const v = await redis.get(routeVersionKey(routeId));
  if (!v) return 1;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function invalidateStopsByRoute(routeId: string) {
  await redis.incr(routeVersionKey(routeId));
}

export async function getStopsForRoute(routeId: string): Promise<CachedStop[]> {
  const version = await getRouteVersion(routeId);
  const k = routeStopsKey(routeId, version);

  const hit = await redis.get(k);
  if (hit) return JSON.parse(hit) as CachedStop[];

  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: {
      routeStops: {
        orderBy: { stopOrder: "asc" },
        select: {
          stopOrder: true,
          stop: { select: { id: true, stopName: true, lat: true, lng: true } },
        },
      },
    },
  });

  if (!route) throw new Error("ROUTE_NOT_FOUND");

  const stops: CachedStop[] = route.routeStops.map((rs) => ({
    stopId: rs.stop.id,
    stopName: rs.stop.stopName,
    stopOrder: rs.stopOrder,
    lat: toNumber(rs.stop.lat),
    lng: toNumber(rs.stop.lng),
  }));

  await redis.set(k, JSON.stringify(stops), { EX: STOPS_TTL_SECONDS });
  return stops;
}

export async function getStopsForTrip(
  tripId: string,
): Promise<{ routeId: string; stops: CachedStop[] }> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { routeId: true },
  });

  if (!trip) throw new Error("TRIP_NOT_FOUND");

  const stops = await getStopsForRoute(trip.routeId);
  return { routeId: trip.routeId, stops };
}
