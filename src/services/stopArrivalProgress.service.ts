import { prisma } from "../config/prisma.js";

export async function getLatestArrivedStopForTrip(tripId: string) {
  return prisma.stopArrival.findFirst({
    where: { tripId },
    orderBy: { actualArrivalTime: "desc" },
    select: {
      stopId: true,
      actualArrivalTime: true,
    },
  });
}
