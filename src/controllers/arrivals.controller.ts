import { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { uuidParamSchema } from "../validators/params.validators.js";

export async function listTripArrivals(req: Request, res: Response) {
  const tripIdParsed = uuidParamSchema.safeParse(req.params.tripId);
  if (!tripIdParsed.success)
    return res.status(400).json({ message: "Invalid tripId" });
  const tripId = tripIdParsed.data;

  const arrivals = await prisma.stopArrival.findMany({
    where: { tripId },
    orderBy: { actualArrivalTime: "asc" },
    include: {
      stop: { select: { id: true, stopName: true, lat: true, lng: true } },
    },
  });

  return res.json({
    tripId,
    arrivals: arrivals.map((a) => ({
      stopId: a.stopId,
      stopName: a.stop.stopName,
      scheduledTime: a.scheduledTime ? a.scheduledTime.toISOString() : null,
      actualArrivalTime: a.actualArrivalTime.toISOString(),
      delayMinutes: a.delayMinutes,
    })),
  });
}
