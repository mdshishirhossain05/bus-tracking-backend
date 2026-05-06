import { TripEventType } from "@prisma/client";
import { prisma } from "../config/prisma.js";

type CreateTripEventInput = {
  tripId: string;
  routeId?: string | null | undefined;
  busId?: string | null | undefined;
  driverId?: string | null | undefined;
  type: TripEventType;
  title: string;
  description: string;
  payload?: unknown;
  createdAt?: Date | undefined;
};

async function createTripEvent(input: CreateTripEventInput) {
  return prisma.tripEvent.create({
    data: {
      tripId: input.tripId,
      routeId: input.routeId ?? null,
      busId: input.busId ?? null,
      driverId: input.driverId ?? null,
      type: input.type,
      title: input.title,
      description: input.description,
      payload: input.payload as any,
      createdAt: input.createdAt ?? new Date(),
    },
  });
}

export async function logTripStarted(params: {
  tripId: string;
  routeId?: string | null;
  busId?: string | null;
  driverId?: string | null;
  startedAt?: Date;
  activationMode?: "MANUAL_DRIVER" | "AUTO_TELEMATICS" | "MANUAL_ADMIN";
  startedByGpsDeviceId?: string | null;
}) {
  return createTripEvent({
    tripId: params.tripId,
    routeId: params.routeId,
    busId: params.busId,
    driverId: params.driverId,
    type: TripEventType.TRIP_STARTED,
    title: "Trip started",
    description: `Trip ${params.tripId} started successfully.`,
    payload: {
      action: "start_trip",
      activationMode: params.activationMode ?? "MANUAL_DRIVER",
      startedByGpsDeviceId: params.startedByGpsDeviceId ?? null,
    },
    createdAt: params.startedAt,
  });
}

export async function logEtaUpdated(params: {
  tripId: string;
  routeId?: string | null;
  busId?: string | null;
  driverId?: string | null;
  etaMinutes?: number | null;
  nextStopName?: string | null;
  updatedAt?: Date;
}) {
  return createTripEvent({
    tripId: params.tripId,
    routeId: params.routeId,
    busId: params.busId,
    driverId: params.driverId,
    type: TripEventType.ETA_UPDATED,
    title: "ETA updated",
    description: `ETA updated to ${params.etaMinutes ?? "N/A"} minute(s).`,
    payload: {
      etaMinutes: params.etaMinutes ?? null,
      nextStopName: params.nextStopName ?? null,
    },
    createdAt: params.updatedAt,
  });
}

export async function logTripEnded(params: {
  tripId: string;
  routeId?: string | null;
  busId?: string | null;
  driverId?: string | null;
  endedAt?: Date;
  endMode?: "MANUAL_DRIVER" | "AUTO_TELEMATICS" | "MANUAL_ADMIN" | "SYSTEM";
  endReason?:
    | "MANUAL_DRIVER"
    | "MANUAL_ADMIN"
    | "AUTO_FINAL_STOP_ARRIVAL"
    | "AUTO_FINAL_STOP_STATIONARY"
    | "AUTO_TELEMETRY_TIMEOUT"
    | "SYSTEM_STALE_TIMEOUT";
  endedBySourceType?: "DRIVER_MOBILE" | "GPS_DEVICE" | "SYSTEM" | null;
}) {
  return createTripEvent({
    tripId: params.tripId,
    routeId: params.routeId,
    busId: params.busId,
    driverId: params.driverId,
    type: TripEventType.TRIP_ENDED,
    title: "Trip ended",
    description: `Trip ${params.tripId} ended successfully.`,
    payload: {
      action: "end_trip",
      endMode: params.endMode ?? "MANUAL_DRIVER",
      endReason: params.endReason ?? "MANUAL_DRIVER",
      endedBySourceType: params.endedBySourceType ?? null,
    },
    createdAt: params.endedAt,
  });
}

export async function logStaleAlert(params: {
  tripId: string;
  routeId?: string | null;
  busId?: string | null;
  driverId?: string | null;
  message?: string;
}) {
  return createTripEvent({
    tripId: params.tripId,
    routeId: params.routeId,
    busId: params.busId,
    driverId: params.driverId,
    type: TripEventType.STALE_ALERT,
    title: "Trip became stale",
    description:
      params.message ?? `Trip ${params.tripId} has stale live location data.`,
    payload: {
      stale: true,
    },
  });
}

export async function logSystemAlert(params: {
  tripId: string;
  routeId?: string | null;
  busId?: string | null;
  driverId?: string | null;
  title: string;
  description: string;
  payload?: unknown;
  createdAt?: Date;
}) {
  return createTripEvent({
    tripId: params.tripId,
    routeId: params.routeId,
    busId: params.busId,
    driverId: params.driverId,
    type: TripEventType.SYSTEM_ALERT,
    title: params.title,
    description: params.description,
    payload: params.payload,
    createdAt: params.createdAt,
  });
}
