import { getIO } from "./io.js";
import { SOCKET_EVENTS, getTripRoom } from "./events.js";

export type TripStartedRealtimePayload = {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string;
  status: string;
  startedAt: string;
};

export type TripLocationRealtimePayload = {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  rawSpeedKmh?: number | null;
  averageSpeedKmh?: number | null;
  displaySpeedKmh?: number | null;
  heading: number | null;
  accuracyM: number | null;
  isStationary?: boolean;
  distanceDeltaMeters?: number | null;
  elapsedSeconds?: number | null;
  source?: string;
  recordedAt: string;
};

export type TripEtaRealtimePayload = {
  tripId: string;
  etaMinutes: number | null;
  nextStopName: string | null;
  updatedAt: string | null;
  eta?: unknown;
};

export type TripStopArrivalStatus =
  | "NO_SCHEDULE"
  | "LATE"
  | "EARLY"
  | "ON_TIME"
  | string;

export type TripStopArrivalRealtimePayload = {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string;
  stopId: string;
  stopName: string;
  stopOrder: number;
  arrivalTime: string;
  recordedAt: string;
  distanceMeters: number;
  dayType: string;
  scheduledTime: string | null;
  scheduledDateUtc: string | null;
  delayMinutes: number;
  status: TripStopArrivalStatus;
};

export type TripEndedRealtimePayload = {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string;
  status: string;
  endedAt: string;
  endMode?: "MANUAL_DRIVER" | "AUTO_TELEMATICS" | "MANUAL_ADMIN" | "SYSTEM";
  endReason?:
    | "MANUAL_DRIVER"
    | "MANUAL_ADMIN"
    | "AUTO_FINAL_STOP_ARRIVAL"
    | "AUTO_FINAL_STOP_STATIONARY"
    | "AUTO_TELEMETRY_TIMEOUT"
    | "SYSTEM_STALE_TIMEOUT";
  endedBySourceType?: "DRIVER_MOBILE" | "GPS_DEVICE" | "SYSTEM" | null;
};

export function emitTripStarted(payload: TripStartedRealtimePayload) {
  const io = getIO();

  io.to(getTripRoom(payload.tripId)).emit(SOCKET_EVENTS.TRIP_STARTED, payload);
}

export function emitTripLocationUpdated(payload: TripLocationRealtimePayload) {
  const io = getIO();

  io.to(getTripRoom(payload.tripId)).emit(SOCKET_EVENTS.LOCATION_UPDATED, {
    tripId: payload.tripId,
    routeId: payload.routeId,
    busId: payload.busId,
    driverId: payload.driverId,
    lat: payload.lat,
    lng: payload.lng,
    latitude: payload.lat,
    longitude: payload.lng,
    speedKmh: payload.displaySpeedKmh ?? payload.speedKmh,
    speed: payload.displaySpeedKmh ?? payload.speedKmh,
    filteredSpeedKmh: payload.speedKmh,
    rawSpeedKmh: payload.rawSpeedKmh ?? null,
    averageSpeedKmh: payload.averageSpeedKmh ?? null,
    rollingAverageSpeedKmh: payload.averageSpeedKmh ?? null,
    displaySpeedKmh: payload.displaySpeedKmh ?? payload.speedKmh ?? null,
    heading: payload.heading,
    accuracyM: payload.accuracyM,
    isStationary: payload.isStationary ?? false,
    distanceDeltaMeters: payload.distanceDeltaMeters ?? null,
    elapsedSeconds: payload.elapsedSeconds ?? null,
    source: payload.source ?? "FILTERED_SERVER",
    recordedAt: payload.recordedAt,
    updatedAt: payload.recordedAt,
  });
}

export function emitTripEtaUpdated(payload: TripEtaRealtimePayload) {
  const io = getIO();

  io.to(getTripRoom(payload.tripId)).emit(SOCKET_EVENTS.ETA_UPDATED, {
    tripId: payload.tripId,
    etaMinutes: payload.etaMinutes,
    nextStopName: payload.nextStopName,
    updatedAt: payload.updatedAt,
    eta: payload.eta ?? {
      etaMinutes: payload.etaMinutes,
      nextStopName: payload.nextStopName,
      updatedAt: payload.updatedAt,
    },
  });
}

export function emitTripStopArrival(payload: TripStopArrivalRealtimePayload) {
  const io = getIO();

  io.to(getTripRoom(payload.tripId)).emit(SOCKET_EVENTS.STOP_ARRIVAL, payload);
}

export function emitTripEnded(payload: TripEndedRealtimePayload) {
  const io = getIO();

  io.to(getTripRoom(payload.tripId)).emit(SOCKET_EVENTS.TRIP_ENDED, payload);
}
