# Socket Events Documentation

This document describes the realtime Socket.IO events used by the **Real-Time Bus Tracking Backend API**.

---

## Connection Overview

Clients connect to the Socket.IO server after authenticating.

After successful authentication, clients may join a trip room using:

```json
{
  "tripId": "trip_uuid_here"
}
```

Trip room pattern:

```text
trip:{tripId}
```

Example:

```text
trip:6a9a5d9b-7ec5-4f0f-8c13-6b3e6b0f2f11
```

---

## Authentication Events

### `connected`

Sent by the server when socket authentication succeeds.

#### Payload

```json
{
  "message": "Socket connected"
}
```

### `auth_error`

Sent by the server when socket authentication fails.

#### Payload

```json
{
  "message": "unauthorized",
  "reason": "error details"
}
```

---

## Room Join / Leave Events

### `join_trip`

Sent by client to join a trip room.

#### Payload

```json
{
  "tripId": "trip_uuid_here"
}
```

### `trip:joined`

Sent by server when the client successfully joins a trip room.

#### Payload

```json
{
  "tripId": "trip_uuid_here",
  "trip": {
    "id": "trip_uuid_here",
    "status": "RUNNING",
    "routeId": "route_uuid_here",
    "busId": "bus_uuid_here",
    "driverId": "driver_uuid_here",
    "startedAt": "2026-03-13T08:00:00.000Z",
    "endedAt": null
  }
}
```

### `join_denied`

Sent by server when joining a trip room is denied.

#### Payload

```json
{
  "tripId": "trip_uuid_here",
  "reason": "TRIP_NOT_FOUND"
}
```

#### Possible Reasons

- `INVALID_TRIP_ID`
- `SESSION_NOT_FOUND`
- `SESSION_REVOKED`
- `SESSION_USER_MISMATCH`
- `TRIP_NOT_FOUND`
- `NOT_YOUR_TRIP`
- `TRIP_NOT_RUNNING`
- `JOIN_ERROR`

### `leave_trip`

Sent by client to leave a trip room.

#### Payload

```json
{
  "tripId": "trip_uuid_here"
}
```

### `left_trip`

Sent by server after leaving a trip room.

#### Payload

```json
{
  "tripId": "trip_uuid_here"
}
```

---

## Trip Lifecycle Events

### `trip:started`

Sent by server when a trip is successfully started.

#### Payload

```json
{
  "tripId": "trip_uuid_here",
  "routeId": "route_uuid_here",
  "busId": "bus_uuid_here",
  "driverId": "driver_uuid_here",
  "status": "RUNNING",
  "startedAt": "2026-03-13T08:00:00.000Z"
}
```

### `trip:location_updated`

Sent by server when a driver sends a valid location update.

#### Payload

```json
{
  "tripId": "trip_uuid_here",
  "routeId": "route_uuid_here",
  "busId": "bus_uuid_here",
  "driverId": "driver_uuid_here",
  "lat": 23.8103,
  "lng": 90.4125,
  "latitude": 23.8103,
  "longitude": 90.4125,
  "speedKmh": 34.5,
  "speed": 34.5,
  "filteredSpeedKmh": 33.8,
  "rawSpeedKmh": 36.1,
  "averageSpeedKmh": 31.2,
  "rollingAverageSpeedKmh": 31.2,
  "displaySpeedKmh": 34.5,
  "heading": 180,
  "accuracyM": 10,
  "isStationary": false,
  "distanceDeltaMeters": 24.2,
  "elapsedSeconds": 2.0,
  "source": "FILTERED_SERVER",
  "recordedAt": "2026-03-13T08:01:10.000Z",
  "updatedAt": "2026-03-13T08:01:10.000Z"
}
```

### `trip:eta_updated`

Sent by server when ETA is recalculated.

#### Payload

```json
{
  "tripId": "trip_uuid_here",
  "etaMinutes": 4,
  "nextStopName": "Main Gate",
  "updatedAt": "2026-03-13T08:01:10.000Z",
  "eta": {
    "etaMinutes": 4,
    "nextStopName": "Main Gate",
    "nextStopDistanceMeters": 950,
    "nearestStopName": "Science Building",
    "nearestStopDistanceMeters": 120,
    "usedSpeedKmh": 24.5,
    "rollingAverageSpeedKmh": 22.8,
    "confidence": "HIGH",
    "finalStopReached": false
  }
}
```

### `trip:stop_arrival`

Sent by server immediately when a stop arrival is detected for the current trip.

#### Payload

```json
{
  "tripId": "trip_uuid_here",
  "routeId": "route_uuid_here",
  "busId": "bus_uuid_here",
  "driverId": "driver_uuid_here",
  "stopId": "stop_uuid_here",
  "stopName": "Main Gate",
  "stopOrder": 3,
  "arrivalTime": "2026-03-13T08:15:00.000Z",
  "recordedAt": "2026-03-13T08:15:00.000Z",
  "distanceMeters": 14,
  "dayType": "THURSDAY",
  "scheduledTime": "08:15:00",
  "scheduledDateUtc": "2026-03-13T02:15:00.000Z",
  "delayMinutes": 1,
  "status": "LATE"
}
```

### `trip:ended`

Sent by server when a trip is ended.

#### Payload

```json
{
  "tripId": "trip_uuid_here",
  "status": "ENDED",
  "endedAt": "2026-03-13T09:25:00.000Z"
}
```

---

## Suggested Frontend Listener Example

```ts
socket.on("connected", (payload) => {
  console.log("connected", payload);
});

socket.on("trip:joined", (payload) => {
  console.log("joined trip", payload);
});

socket.on("trip:started", (payload) => {
  console.log("trip started", payload);
});

socket.on("trip:location_updated", (payload) => {
  console.log("location update", payload);
});

socket.on("trip:eta_updated", (payload) => {
  console.log("eta update", payload);
});

socket.on("trip:stop_arrival", (payload) => {
  console.log("stop arrival", payload);
});

socket.on("trip:ended", (payload) => {
  console.log("trip ended", payload);
});
```

---

## Suggested Frontend Emit Example

```ts
socket.emit("join_trip", {
  tripId: "trip_uuid_here",
});

socket.emit("leave_trip", {
  tripId: "trip_uuid_here",
});
```

---

## Notes

- REST APIs remain the source of truth.
- Socket events provide live updates only.
- Clients should handle reconnects safely.
- Clients should rejoin trip rooms after reconnect if needed.

---

## Git commit message

```bash
git commit -m "feat(realtime): emit trip stop arrival socket events"
```
