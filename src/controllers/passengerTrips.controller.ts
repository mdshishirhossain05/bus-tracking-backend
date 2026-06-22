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

  // De-duplicate by (routeId, busId): when the same bus has both a
  // RUNNING trip AND a stale PRE_TRIP shell on the same route, only the
  // RUNNING one matters to the rider — the pre-trip row is the empty
  // shell the bus already departed from. Because the query orders by
  // status DESC ("RUNNING" > "PRE_TRIP"), keeping the first occurrence
  // per key naturally drops the PRE_TRIP duplicate.
  const seen = new Set<string>();
  const dedupedTrips = trips.filter((trip) => {
    const key = `${trip.routeId}:${trip.busId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return sendSuccess(res, {
    message: "Active trips retrieved successfully",
    data: {
      trips: dedupedTrips.map((trip) => ({
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
