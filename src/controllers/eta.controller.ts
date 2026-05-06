import { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { computeNextStopAndEta } from "../services/eta.service.js";
import { getTripRealtimeState } from "../services/tripRealtimeState.service.js";
import { getStopsForTrip } from "../services/tripStopsCache.service.js";
import { env } from "../config/env.js";
import { getLatestArrivedStopForTrip } from "../services/stopArrivalProgress.service.js";

export async function getTripEta(req: Request, res: Response) {
  const tripId = req.params.tripId;
  if (typeof tripId !== "string") {
    return res.status(400).json({ message: "Invalid tripId" });
  }

  let stops: Awaited<ReturnType<typeof getStopsForTrip>>["stops"];
  try {
    const s = await getStopsForTrip(tripId);
    stops = s.stops;
  } catch (e: any) {
    if (e?.message === "TRIP_NOT_FOUND") {
      return res.status(404).json({ message: "Trip not found" });
    }
    return res.status(500).json({ message: "Failed to load stops" });
  }

  const realtime = await getTripRealtimeState(tripId);

  let lastLat: number;
  let lastLng: number;
  let lastSpeed: number | null;
  let rollingAverageSpeedKmh: number | null = null;
  let recordedAt: Date;
  let source: "REDIS" | "DB";

  if (realtime) {
    lastLat = realtime.lat;
    lastLng = realtime.lng;
    lastSpeed = realtime.displaySpeedKmh ?? realtime.speedKmh;
    rollingAverageSpeedKmh = realtime.averageSpeedKmh ?? null;
    recordedAt = realtime.recordedAt;
    source = "REDIS";
  } else {
    const last = await prisma.locationLog.findFirst({
      where: { tripId },
      orderBy: { recordedAt: "desc" },
    });

    if (!last) {
      return res.json({ tripId, eta: null, message: "No location yet" });
    }

    lastLat = Number(String(last.lat));
    lastLng = Number(String(last.lng));
    lastSpeed = last.speedKmh ? Number(String(last.speedKmh)) : null;
    recordedAt = last.recordedAt;
    source = "DB";
  }

  const latestArrival = await getLatestArrivedStopForTrip(tripId);

  const defaultSpeedKmh = Number(env.DEFAULT_SPEED_KMH ?? 20);
  const arrivalRadiusMeters = Number(env.ARRIVAL_RADIUS_METERS ?? 80);

  const eta = computeNextStopAndEta({
    currentLat: lastLat,
    currentLng: lastLng,
    stops,
    lastSpeedKmh: lastSpeed,
    rollingAverageSpeedKmh,
    defaultSpeedKmh,
    arrivalRadiusMeters,
    lastArrivedStopId: latestArrival?.stopId ?? null,
  });

  return res.json({
    tripId,
    lastLocation: {
      lat: String(lastLat),
      lng: String(lastLng),
      speedKmh: lastSpeed != null ? String(lastSpeed) : null,
      recordedAt: recordedAt.toISOString(),
      source,
    },
    lastArrivedStopId: latestArrival?.stopId ?? null,
    eta,
  });
}
