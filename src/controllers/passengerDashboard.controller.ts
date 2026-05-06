import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { uuidParamSchema } from "../validators/params.validators.js";
import {
  computeNextStopAndEta,
  type StopPoint,
} from "../services/eta.service.js";
import { toNumber } from "../utils/geo.js";
import { sendSuccess } from "../utils/apiResponse.js";

async function buildDashboardByTripId(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      bus: {
        select: { id: true, busCode: true, plateNumber: true, capacity: true },
      },
      route: {
        select: {
          id: true,
          routeName: true,
          description: true,
          routeStops: {
            orderBy: { stopOrder: "asc" },
            select: {
              stopOrder: true,
              stop: {
                select: { id: true, stopName: true, lat: true, lng: true },
              },
            },
          },
        },
      },
    },
  });

  if (!trip) return null;

  const latestLog = await prisma.locationLog.findFirst({
    where: { tripId },
    orderBy: { recordedAt: "desc" },
  });

  const arrivals = await prisma.stopArrival.findMany({
    where: { tripId },
    orderBy: { actualArrivalTime: "asc" },
    include: { stop: { select: { id: true, stopName: true } } },
  });

  const lastArrival = await prisma.stopArrival.findFirst({
    where: { tripId },
    orderBy: { actualArrivalTime: "desc" },
    include: { stop: { select: { id: true, stopName: true } } },
  });

  const stops: StopPoint[] = trip.route.routeStops.map((rs) => ({
    stopId: rs.stop.id,
    stopName: rs.stop.stopName,
    stopOrder: rs.stopOrder,
    lat: rs.stop.lat,
    lng: rs.stop.lng,
  }));

  const etaResult =
    latestLog && stops.length > 0
      ? computeNextStopAndEta({
          currentLat: toNumber(latestLog.lat),
          currentLng: toNumber(latestLog.lng),
          stops,
          lastSpeedKmh: latestLog.speedKmh
            ? Number(String(latestLog.speedKmh))
            : null,
          arrivalRadiusMeters: Number(process.env.ARRIVAL_RADIUS_METERS ?? 80),
          defaultSpeedKmh: 20,
        })
      : null;

  const eta = etaResult
    ? {
        ...etaResult,
        nextStopName: etaResult.nextStop?.stopName ?? null,
        nextStopDistanceMeters: etaResult.nextStop?.distanceMeters ?? null,
        nearestStopName: etaResult.nearestStop.stopName,
        nearestStopDistanceMeters: etaResult.nearestStop.distanceMeters,
      }
    : null;

  return {
    trip: {
      id: trip.id,
      status: trip.status,
      startTime: trip.startTime ? trip.startTime.toISOString() : null,
      endTime: trip.endTime ? trip.endTime.toISOString() : null,
      bus: trip.bus,
      route: {
        id: trip.route.id,
        routeName: trip.route.routeName,
        description: trip.route.description,
      },
    },
    latestLocation: latestLog
      ? {
          lat: toNumber(latestLog.lat),
          lng: toNumber(latestLog.lng),
          speedKmh:
            latestLog.speedKmh != null
              ? Number(String(latestLog.speedKmh))
              : null,
          recordedAt: latestLog.recordedAt.toISOString(),
        }
      : null,
    eta,
    lastArrival: lastArrival
      ? {
          stopId: lastArrival.stopId,
          stopName: lastArrival.stop.stopName,
          scheduledTime: lastArrival.scheduledTime
            ? lastArrival.scheduledTime.toISOString().slice(11, 19)
            : null,
          actualArrivalTime: lastArrival.actualArrivalTime.toISOString(),
          delayMinutes: lastArrival.delayMinutes,
        }
      : null,
    arrivals: arrivals.map((a) => ({
      stopId: a.stopId,
      stopName: a.stop.stopName,
      scheduledTime: a.scheduledTime
        ? a.scheduledTime.toISOString().slice(11, 19)
        : null,
      actualArrivalTime: a.actualArrivalTime.toISOString(),
      delayMinutes: a.delayMinutes,
    })),
    stops: stops.map((s) => ({
      stopId: s.stopId,
      stopName: s.stopName,
      stopOrder: s.stopOrder,
      lat: toNumber(s.lat),
      lng: toNumber(s.lng),
    })),
  };
}

export async function getTripDashboard(req: Request, res: Response) {
  const tripIdParsed = uuidParamSchema.safeParse(req.params.tripId);

  if (!tripIdParsed.success) {
    return res.status(400).json({ message: "Invalid tripId" });
  }

  const dashboard = await buildDashboardByTripId(tripIdParsed.data);

  if (!dashboard) {
    return res.status(404).json({ message: "Trip not found" });
  }

  return sendSuccess(res, {
    message: "Trip dashboard fetched successfully",
    data: dashboard,
  });
}

export async function getActiveRouteDashboard(req: Request, res: Response) {
  const routeIdParsed = uuidParamSchema.safeParse(req.params.routeId);

  if (!routeIdParsed.success) {
    return res.status(400).json({ message: "Invalid routeId" });
  }

  const routeId = routeIdParsed.data;

  const activeTrip = await prisma.trip.findFirst({
    where: { routeId, status: "RUNNING" },
    orderBy: { startTime: "desc" },
    select: { id: true },
  });

  if (!activeTrip) {
    return res.status(404).json({
      message: "No active trip for this route",
      routeId,
    });
  }

  const dashboard = await buildDashboardByTripId(activeTrip.id);

  if (!dashboard) {
    return res.status(404).json({ message: "Trip not found" });
  }

  return sendSuccess(res, {
    message: "Active route dashboard fetched successfully",
    data: {
      routeId,
      activeTripId: activeTrip.id,
      ...dashboard,
    },
  });
}
