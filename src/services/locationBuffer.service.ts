import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";

type BufferedLocation = {
  tripId: string;
  lat: Prisma.Decimal | number;
  lng: Prisma.Decimal | number;
  speedKmh?: Prisma.Decimal | number | null;
  heading?: number | null;
  accuracyM?: Prisma.Decimal | number | null;
  recordedAt: Date;
};

const lastWriteAt = new Map<string, number>();

const WRITE_INTERVAL_MS = Number(env.LOCATION_DB_WRITE_INTERVAL_MS ?? 10_000);

export async function maybePersistLocation(loc: BufferedLocation): Promise<{
  persisted: boolean;
  logId?: string;
}> {
  const now = Date.now();
  const last = lastWriteAt.get(loc.tripId) ?? 0;

  if (now - last < WRITE_INTERVAL_MS) {
    return { persisted: false };
  }

  lastWriteAt.set(loc.tripId, now);

  const data: Prisma.LocationLogUncheckedCreateInput = {
    tripId: loc.tripId,
    lat: loc.lat as any,
    lng: loc.lng as any,
    recordedAt: loc.recordedAt,
    ...(loc.speedKmh !== undefined ? { speedKmh: loc.speedKmh as any } : {}),
    ...(loc.heading !== undefined ? { heading: loc.heading } : {}),
    ...(loc.accuracyM !== undefined ? { accuracyM: loc.accuracyM as any } : {}),
  };

  const log = await prisma.locationLog.create({ data });

  return { persisted: true, logId: log.id };
}
