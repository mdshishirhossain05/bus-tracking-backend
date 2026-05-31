import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { sendSuccess } from "../utils/apiResponse.js";

export async function listActiveTrips(_req: Request, res: Response) {
  const trips = await prisma.trip.findMany({
    where: { status: { in: ["RUNNING", "PRE_TRIP"] } },
    orderBy: [{ status: "desc" }, { startTime: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      status: true,
      startTime: true,
      preTripPhase: true,
      preTripStartedAt: true,
      route: { select: { id: true, routeName: true } },
      bus: { select: { id: true, busCode: true, plateNumber: true } },
      driver: { select: { id: true, fullName: true } },
    },
  });

  return sendSuccess(res, {
    message: "Active trips retrieved successfully",
    data: {
      trips: trips.map((trip) => ({
        tripId: trip.id,
        routeId: trip.routeId,
        routeName: trip.route.routeName,
        busId: trip.busId,
        busLabel: trip.bus.busCode,
        driverId: trip.driverId,
        driverName: trip.driver?.fullName ?? null,
        status: trip.status,
        startedAt: trip.startTime?.toISOString() ?? null,
        preTripPhase: trip.preTripPhase ?? null,
        preTripStartedAt: trip.preTripStartedAt?.toISOString() ?? null,
      })),
    },
  });
}
