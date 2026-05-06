import { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { setRouteStopsSchema } from "../validators/routeStop.validators.js";
import { uuidParamSchema } from "../validators/params.validators.js";
import { invalidateStopsByRoute } from "../services/tripStopsCache.service.js";
import { writeAuditLog, getRequestIp } from "../services/audit.service.js";
import {
  buildRouteMetrics,
  type LatLng,
  type RouteMetrics,
} from "../services/googleRoutes.service.js";

function toNumber(value: unknown) {
  return Number(value);
}

function durationSecondsToMinutes(value: number | null) {
  if (value == null) return null;
  return Number((value / 60).toFixed(1));
}

function getGeometrySource(routeGeometry: unknown[]) {
  return routeGeometry.length >= 2 ? "SAVED_GEOMETRY" : "UNKNOWN";
}

function getTotalDistanceKmFromStops(
  stops: Array<{ distanceFromStartKm: unknown }>,
) {
  const distances = stops
    .map((item) =>
      item.distanceFromStartKm == null
        ? null
        : toNumber(item.distanceFromStartKm),
    )
    .filter(
      (value): value is number => value != null && Number.isFinite(value),
    );

  if (!distances.length) return null;

  return Math.max(...distances);
}

function mapRoutingModeToSource(metrics: RouteMetrics) {
  if (metrics.routingMode === "google_routes") return "GOOGLE_ROUTES";
  if (metrics.routingMode === "fallback") return "STRAIGHT_LINE";
  return "UNKNOWN";
}

function mapRouteStopsResponse(route: {
  id: string;
  routeName: string;
  routeStops: Array<{
    id: string;
    stopId: string;
    stopOrder: number;
    distanceFromStartKm: unknown;
    stop: {
      id: string;
      stopName: string;
      lat: unknown;
      lng: unknown;
    };
  }>;
}) {
  return route.routeStops.map((item) => ({
    id: item.id,
    stopId: item.stopId,
    stopOrder: item.stopOrder,
    distanceFromStartKm:
      item.distanceFromStartKm == null
        ? null
        : toNumber(item.distanceFromStartKm),
    stop: {
      id: item.stop.id,
      stopName: item.stop.stopName,
      lat: toNumber(item.stop.lat),
      lng: toNumber(item.stop.lng),
    },
  }));
}

export async function getRouteWithStops(req: Request, res: Response) {
  const routeIdParsed = uuidParamSchema.safeParse(req.params.routeId);
  if (!routeIdParsed.success) {
    return res.status(400).json({ message: "Invalid route id provided." });
  }

  const routeId = routeIdParsed.data;

  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      routeStops: {
        orderBy: { stopOrder: "asc" },
        include: { stop: true },
      },
      geometry: true,
    },
  });

  if (!route) {
    return res.status(404).json({ message: "Route not found." });
  }

  const geometry = Array.isArray(route.geometry?.polyline)
    ? (route.geometry.polyline as unknown[])
    : [];

  return res.json({
    message: "Route stops loaded successfully.",
    route: {
      id: route.id,
      routeName: route.routeName,
    },
    stops: mapRouteStopsResponse(route),
    geometry,
    summary: {
      distanceKm: getTotalDistanceKmFromStops(route.routeStops),
      durationMinutes: null,
      source: getGeometrySource(geometry),
    },
  });
}

export async function setRouteStops(req: Request, res: Response) {
  const routeIdParsed = uuidParamSchema.safeParse(req.params.routeId);
  if (!routeIdParsed.success) {
    return res.status(400).json({ message: "Invalid route id provided." });
  }

  const routeId = routeIdParsed.data;

  const bodyParsed = setRouteStopsSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({
      message:
        "Route stops request is invalid. Check stop order and duplicate selections.",
      errors: bodyParsed.error.flatten(),
    });
  }

  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      routeStops: {
        orderBy: { stopOrder: "asc" },
        include: { stop: true },
      },
    },
  });

  if (!route) {
    return res.status(404).json({ message: "Route not found." });
  }

  const stopIds = bodyParsed.data.stops.map((s) => s.stopId);
  const uniqueStopIds = Array.from(new Set(stopIds));

  const foundStops = uniqueStopIds.length
    ? await prisma.stop.findMany({
        where: {
          id: { in: uniqueStopIds },
        },
        select: {
          id: true,
          stopName: true,
          lat: true,
          lng: true,
          isActive: true,
        },
      })
    : [];

  if (foundStops.length !== uniqueStopIds.length) {
    const foundStopIds = new Set(foundStops.map((s) => s.id));
    const missingStopIds = uniqueStopIds.filter((id) => !foundStopIds.has(id));

    return res.status(400).json({
      message:
        "Some selected stops no longer exist. Please refresh and try again.",
      missingStopIds,
    });
  }

  const inactiveStops = foundStops.filter((stop) => !stop.isActive);
  if (inactiveStops.length > 0) {
    return res.status(400).json({
      message:
        "One or more selected stops are inactive. Activate them first or remove them from the route.",
      inactiveStops: inactiveStops.map((stop) => ({
        id: stop.id,
        stopName: stop.stopName,
      })),
    });
  }

  const foundStopMap = new Map(foundStops.map((stop) => [stop.id, stop]));

  const orderedStops = bodyParsed.data.stops
    .slice()
    .sort((a, b) => a.stopOrder - b.stopOrder)
    .map((item, index) => {
      const stop = foundStopMap.get(item.stopId)!;

      return {
        stopId: item.stopId,
        stopOrder: index + 1,
        stopName: stop.stopName,
        lat: toNumber(stop.lat),
        lng: toNumber(stop.lng),
      };
    });

  const metrics = await buildRouteMetrics(
    orderedStops.map(
      (stop): LatLng => ({
        lat: stop.lat,
        lng: stop.lng,
      }),
    ),
  );

  const beforeJson = route.routeStops.map((rs) => ({
    stopId: rs.stopId,
    stopOrder: rs.stopOrder,
    distanceFromStartKm:
      rs.distanceFromStartKm != null ? String(rs.distanceFromStartKm) : null,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.routeStop.deleteMany({ where: { routeId } });

    if (orderedStops.length > 0) {
      await tx.routeStop.createMany({
        data: orderedStops.map((stop, index) => ({
          routeId,
          stopId: stop.stopId,
          stopOrder: stop.stopOrder,
          distanceFromStartKm: metrics.distancesKm[index] ?? null,
        })),
      });
    }

    if (metrics.geometry.length > 0) {
      await tx.routeGeometry.upsert({
        where: { routeId },
        update: {
          polyline: metrics.geometry,
        },
        create: {
          routeId,
          polyline: metrics.geometry,
        },
      });
    } else {
      await tx.routeGeometry.deleteMany({
        where: { routeId },
      });
    }
  });

  await invalidateStopsByRoute(routeId);

  const afterJson = orderedStops.map((stop, index) => ({
    stopId: stop.stopId,
    stopOrder: stop.stopOrder,
    distanceFromStartKm: metrics.distancesKm[index] ?? null,
  }));

  await writeAuditLog({
    actorUserId: (req as any).user?.id ?? null,
    actorRole: (req as any).user?.role ?? null,
    action: "ROUTE_STOPS_UPDATED",
    entityType: "Route",
    entityId: routeId,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    beforeJson,
    afterJson,
    metaJson: {
      stopCountBefore: beforeJson.length,
      stopCountAfter: afterJson.length,
      routingMode: metrics.routingMode,
      geometryPointCount: metrics.geometry.length,
      durationSeconds: metrics.durationSeconds,
      distanceKm: metrics.distancesKm.at(-1) ?? null,
    },
  });

  const savedRoute = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      routeStops: {
        orderBy: { stopOrder: "asc" },
        include: { stop: true },
      },
      geometry: true,
    },
  });

  if (!savedRoute) {
    return res.status(404).json({ message: "Route not found after save." });
  }

  const savedGeometry = Array.isArray(savedRoute.geometry?.polyline)
    ? (savedRoute.geometry.polyline as unknown[])
    : [];

  return res.json({
    message:
      orderedStops.length === 0
        ? "All route stops were removed successfully."
        : metrics.routingMode === "google_routes"
          ? "Route stops saved successfully. Google Routes recalculated distance, duration, and road geometry."
          : "Route stops saved successfully. Straight-line fallback was used because Google Routes was unavailable.",
    routeId,
    routingMode: metrics.routingMode,
    geometryPointCount: metrics.geometry.length,
    distancesKm: metrics.distancesKm,
    durationSeconds: metrics.durationSeconds,
    summary: {
      distanceKm: metrics.distancesKm.at(-1) ?? null,
      durationMinutes: durationSecondsToMinutes(metrics.durationSeconds),
      source: mapRoutingModeToSource(metrics),
    },
    route: {
      id: savedRoute.id,
      routeName: savedRoute.routeName,
    },
    stops: mapRouteStopsResponse(savedRoute),
    geometry: savedGeometry,
  });
}
