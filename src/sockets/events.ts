export const SOCKET_EVENTS = {
  CONNECTED: "connected",
  AUTH_ERROR: "auth_error",

  JOIN_TRIP: "join_trip",
  JOINED_TRIP: "trip:joined",
  JOIN_DENIED: "join_denied",
  LEAVE_TRIP: "leave_trip",
  LEFT_TRIP: "left_trip",

  LOCATION_UPDATED: "trip:location_updated",
  ETA_UPDATED: "trip:eta_updated",
  STOP_ARRIVAL: "trip:stop_arrival",
  TRIP_STARTED: "trip:started",
  TRIP_ENDED: "trip:ended",

  NOTIFICATION: "notification",
} as const;

export function getTripRoom(tripId: string) {
  return `trip:${tripId}`;
}

export function getUserRoom(userId: string) {
  return `user:${userId}`;
}
