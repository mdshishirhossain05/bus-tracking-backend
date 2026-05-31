import type { OccupancyLevel } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/appError.js";
import { getIO } from "../sockets/io.js";
import { SOCKET_EVENTS, getTripRoom } from "../sockets/events.js";

export type OccupancyAggregate = {
  tripId: string;
  level: OccupancyLevel | null;
  voteCount: number;
  counts: Record<OccupancyLevel, number>;
  myVote: OccupancyLevel | null;
};

function isValidLevel(value: unknown): value is OccupancyLevel {
  return value === "LIGHT" || value === "MODERATE" || value === "FULL";
}

export async function voteOccupancyService(params: {
  userId: string;
  tripId: string;
  level: unknown;
}): Promise<OccupancyAggregate> {
  if (!isValidLevel(params.level)) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_LEVEL",
      message: "Level must be one of LIGHT, MODERATE, FULL",
    });
  }

  const trip = await prisma.trip.findUnique({
    where: { id: params.tripId },
    select: { id: true, status: true },
  });
  if (!trip) {
    throw new AppError({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
      message: "Trip not found",
    });
  }
  if (trip.status === "ENDED") {
    throw new AppError({
      statusCode: 400,
      code: "TRIP_ENDED",
      message: "Cannot vote on a trip that has ended",
    });
  }

  await prisma.occupancyVote.upsert({
    where: {
      tripId_userId: { tripId: params.tripId, userId: params.userId },
    },
    create: {
      tripId: params.tripId,
      userId: params.userId,
      level: params.level,
    },
    update: { level: params.level },
  });

  const aggregate = await getOccupancyAggregateService({
    userId: params.userId,
    tripId: params.tripId,
  });

  // Broadcast the new aggregate to anyone watching this trip live.
  try {
    const io = getIO();
    io.to(getTripRoom(params.tripId)).emit(
      SOCKET_EVENTS.OCCUPANCY_UPDATED,
      {
        tripId: aggregate.tripId,
        level: aggregate.level,
        voteCount: aggregate.voteCount,
        counts: aggregate.counts,
      },
    );
  } catch {
    // Socket layer not ready — REST consumers still see the latest value.
  }

  return aggregate;
}

export async function getOccupancyAggregateService(params: {
  userId: string;
  tripId: string;
}): Promise<OccupancyAggregate> {
  // Only consider votes from the last 60 minutes — older votes can
  // mislead riders, since a bus that was full at 8am may be empty by noon.
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const votes = await prisma.occupancyVote.findMany({
    where: { tripId: params.tripId, updatedAt: { gte: since } },
    select: { level: true, userId: true },
  });

  const counts: Record<OccupancyLevel, number> = {
    LIGHT: 0,
    MODERATE: 0,
    FULL: 0,
  };
  for (const v of votes) {
    counts[v.level] += 1;
  }

  // Pick the level with the most recent-window votes; null if no votes.
  let level: OccupancyLevel | null = null;
  let best = 0;
  for (const k of Object.keys(counts) as OccupancyLevel[]) {
    if (counts[k] > best) {
      best = counts[k];
      level = k;
    }
  }

  const myVote = votes.find((v) => v.userId === params.userId)?.level ?? null;

  return {
    tripId: params.tripId,
    level,
    voteCount: votes.length,
    counts,
    myVote,
  };
}
