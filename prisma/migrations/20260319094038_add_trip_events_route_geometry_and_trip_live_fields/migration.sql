-- CreateEnum
CREATE TYPE "TripEventType" AS ENUM ('TRIP_STARTED', 'LOCATION_UPDATED', 'ETA_UPDATED', 'TRIP_ENDED', 'STALE_ALERT', 'DRIVER_ASSIGNED', 'DRIVER_UNASSIGNED', 'SYSTEM_ALERT');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "isStale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAccuracyM" DECIMAL(8,2),
ADD COLUMN     "lastEtaMinutes" INTEGER,
ADD COLUMN     "lastHeading" INTEGER,
ADD COLUMN     "lastLatitude" DECIMAL(10,7),
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ADD COLUMN     "lastLongitude" DECIMAL(10,7),
ADD COLUMN     "lastSpeedKmh" DECIMAL(6,2),
ADD COLUMN     "nextStopName" TEXT;

-- CreateTable
CREATE TABLE "RouteGeometry" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "polyline" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteGeometry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripEvent" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "routeId" TEXT,
    "busId" TEXT,
    "driverId" TEXT,
    "type" "TripEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RouteGeometry_routeId_key" ON "RouteGeometry"("routeId");

-- CreateIndex
CREATE INDEX "TripEvent_tripId_createdAt_idx" ON "TripEvent"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "TripEvent_createdAt_idx" ON "TripEvent"("createdAt");

-- CreateIndex
CREATE INDEX "TripEvent_type_createdAt_idx" ON "TripEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "TripEvent_routeId_idx" ON "TripEvent"("routeId");

-- CreateIndex
CREATE INDEX "TripEvent_driverId_idx" ON "TripEvent"("driverId");

-- CreateIndex
CREATE INDEX "TripEvent_busId_idx" ON "TripEvent"("busId");

-- CreateIndex
CREATE INDEX "Trip_lastLocationAt_idx" ON "Trip"("lastLocationAt");

-- CreateIndex
CREATE INDEX "Trip_isStale_idx" ON "Trip"("isStale");

-- AddForeignKey
ALTER TABLE "RouteGeometry" ADD CONSTRAINT "RouteGeometry_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
