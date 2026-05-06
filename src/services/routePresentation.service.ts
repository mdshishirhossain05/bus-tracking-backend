import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/appError.js";

export async function getRoutePresentationService(routeId: string) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      geometry: true,
      routeStops: {
        include: {
          stop: true,
        },
        orderBy: {
          stopOrder: "asc",
        },
      },
    },
  });

  if (!route) {
    throw new AppError({
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: "Route not found",
    });
  }

  const polyline = Array.isArray(route.geometry?.polyline)
    ? route.geometry.polyline
        .filter(
          (point): point is [number, number] =>
            Array.isArray(point) &&
            point.length === 2 &&
            typeof point[0] === "number" &&
            typeof point[1] === "number",
        )
        .map(
          (point) => [Number(point[0]), Number(point[1])] as [number, number],
        )
    : [];

  const stops = route.routeStops.map((routeStop) => ({
    id: routeStop.stop.id,
    name: routeStop.stop.stopName,
    latitude: Number(routeStop.stop.lat),
    longitude: Number(routeStop.stop.lng),
    order: routeStop.stopOrder,
  }));

  const origin = stops[0] ?? null;
  const destination = stops.length > 0 ? stops[stops.length - 1] : null;

  return {
    routeId: route.id,
    routeName: route.routeName,
    polyline,
    stops,
    origin,
    destination,
  };
}
