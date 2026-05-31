import { getIO } from "./io.js";
import { SOCKET_EVENTS, getTripRoom } from "./events.js";
import { createArrivalNotificationsService } from "../services/notification.service.js";

export type TripStartedRealtimePayload = {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  status: string;
  startedAt: string;
};

export type TripLocationRealtimePayload = {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string | null;
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
  sourceType?: "DRIVER_MOBILE" | "GPS_DEVICE" | null;
  sourceStatus?: "HEALTHY" | "STALE" | "UNHEALTHY" | "DISCONNECTED" | null;
  selectionReason?:
    | "DRIVER_ONLY"
    | "GPS_ONLY"
    | "GPS_PRIORITY"
    | "DRIVER_PRIORITY"
    | "GPS_FALLBACK_TO_DRIVER"
    | "DRIVER_FALLBACK_TO_GPS"
    | "MOST_RECENT_HEALTHY"
    | "NO_HEALTHY_SOURCE"
    | "STICKY_PREVIOUS_SOURCE"
    | "HOLD_LAST_GOOD_STATE"
    | null;
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
  driverId: string | null;
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
  driverId: string | null;
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
    sourceType: payload.sourceType ?? null,
    sourceStatus: payload.sourceStatus ?? null,
    selectionReason: payload.selectionReason ?? null,
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

  // Fan out a persisted notification to passengers who favorited the route.
  // Best-effort: never block or fail the realtime broadcast.
  void createArrivalNotificationsService({
    routeId: payload.routeId,
    stopName: payload.stopName,
    delayMinutes: payload.delayMinutes,
    status: payload.status,
  }).catch(() => {
    // Notification fan-out is non-critical.
  });
}

export function emitTripEnded(payload: TripEndedRealtimePayload) {
  const io = getIO();

  io.to(getTripRoom(payload.tripId)).emit(SOCKET_EVENTS.TRIP_ENDED, payload);
}

export type TripPreTripPhase =
  | "AT_DEPOT"
  | "APPROACHING_ORIGIN"
  | "AT_ORIGIN";

export type TripPreTripOpenedRealtimePayload = {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  serviceScheduleId: string | null;
  preTripPhase: TripPreTripPhase;
  preTripStartedAt: string;
  scheduledDepartureAt: string | null;
};

export type TripPreTripStateRealtimePayload = {
  tripId: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  preTripPhase: TripPreTripPhase;
  distanceToOriginMeters: number | null;
  originArrivedAt: string | null;
  lat: number | null;
  lng: number | null;
  recordedAt: string | null;
};

export function emitTripPreTripOpened(
  payload: TripPreTripOpenedRealtimePayload,
) {
  const io = getIO();
  io.to(getTripRoom(payload.tripId)).emit(
    SOCKET_EVENTS.PRE_TRIP_OPENED,
    payload,
  );
}

export function emitTripPreTripStateChanged(
  payload: TripPreTripStateRealtimePayload,
) {
  const io = getIO();
  io.to(getTripRoom(payload.tripId)).emit(
    SOCKET_EVENTS.PRE_TRIP_STATE_CHANGED,
    payload,
  );
}
