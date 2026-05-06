import { Request, Response } from "express";
import { prisma } from "../config/prisma.js";

export async function getTripDetails(req: Request, res: Response) {
  const { tripId } = req.params;
  if (typeof tripId !== "string")
    return res.status(400).json({ message: "Invalid tripId" });

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      bus: true,
      driver: { select: { id: true, fullName: true } },
      route: {
        include: {
          routeStops: {
            orderBy: { stopOrder: "asc" },
            include: { stop: true },
          },
        },
      },
    },
  });

  if (!trip) return res.status(404).json({ message: "Trip not found" });

  res.json({ trip });
}
