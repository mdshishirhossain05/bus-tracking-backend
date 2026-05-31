import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { emitTripStarted } from "../sockets/tripRealtime.js";
import { logTripStarted } from "./tripEvent.service.js";

/**
 * Promote a PRE_TRIP trip to RUNNING.
 *
 * Used when the bus dwells in the origin geofence long enough for the
 * server to auto-start the trip, or when the driver manually taps "Start".
 * Idempotent: if the trip is already RUNNING (or ENDED) we do nothing
 * destructive and just return the current state.
 */
export async function promotePreTripToRunning(params: {
  tripId: string;
  startedAt: Date;
  activationMode: "MANUAL_DRIVER" | "AUTO_TELEMATICS" | "MANUAL_ADMIN";
  reason?: string;
}): Promise<{
  promoted: boolean;
  status: "PRE_TRIP" | "RUNNING" | "ENDED" | "PLANNED";
}> {
  const before = await prisma.trip.findUnique({
    where: { id: params.tripId },
    select: { id: true, status: true },
  });

  if (!before) {
    return { promoted: false, status: "ENDED" };
  }

  if (before.status === "RUNNING" || before.status === "ENDED") {
    return { promoted: false, status: before.status };
  }

  const updated = await prisma.trip.update({
    where: { id: params.tripId },
    data: {
      status: "RUNNING",
      startTime: params.startedAt,
      activationMode: params.activationMode,
      preTripPhase: null,
      originArrivedAt: null,
    },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      startedByGpsDeviceId: true,
      status: true,
    },
  });

  try {
    await logTripStarted({
      tripId: updated.id,
      routeId: updated.routeId,
      busId: updated.busId,
      driverId: updated.driverId,
      startedAt: params.startedAt,
      activationMode: params.activationMode,
      startedByGpsDeviceId: updated.startedByGpsDeviceId ?? null,
    });
  } catch (err) {
    logger.warn(
      { err, tripId: updated.id },
      "logTripStarted (pre-trip promote) failed",
    );
  }

  try {
    emitTripStarted({
      tripId: updated.id,
      routeId: updated.routeId,
      busId: updated.busId,
      driverId: updated.driverId,
      status: updated.status,
      startedAt: params.startedAt.toISOString(),
    });
  } catch (err) {
    logger.warn(
      { err, tripId: updated.id },
      "emitTripStarted (pre-trip promote) failed",
    );
  }

  logger.info(
    {
      tripId: updated.id,
      activationMode: params.activationMode,
      reason: params.reason ?? null,
    },
    "pre-trip trip promoted to RUNNING",
  );

  return { promoted: true, status: "RUNNING" };
}
