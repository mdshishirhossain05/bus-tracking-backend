import { Request, Response } from "express";
import { prisma } from "../config/prisma.js";

export async function getTripLocationHistory(req: Request, res: Response) {
  const { tripId } = req.params;
  if (typeof tripId !== "string")
    return res.status(400).json({ message: "Invalid tripId" });

  const limit = Math.min(Number(req.query.limit ?? 200), 1000);

  const logs = await prisma.locationLog.findMany({
    where: { tripId },
    orderBy: { recordedAt: "desc" },
    take: limit,
  });

  res.json({
    tripId,
    logs: logs.map((l) => ({
      lat: String(l.lat),
      lng: String(l.lng),
      recordedAt: l.recordedAt.toISOString(),
      speedKmh: l.speedKmh ? String(l.speedKmh) : null,
    })),
  });
}
