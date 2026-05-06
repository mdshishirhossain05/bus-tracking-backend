-- CreateEnum
CREATE TYPE "TrackingSourceType" AS ENUM ('DRIVER_MOBILE', 'GPS_DEVICE');

-- CreateEnum
CREATE TYPE "TrackingSourceStatus" AS ENUM ('HEALTHY', 'STALE', 'UNHEALTHY', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "TrackingSelectionReason" AS ENUM ('DRIVER_ONLY', 'GPS_ONLY', 'GPS_PRIORITY', 'DRIVER_PRIORITY', 'GPS_FALLBACK_TO_DRIVER', 'DRIVER_FALLBACK_TO_GPS', 'MOST_RECENT_HEALTHY', 'NO_HEALTHY_SOURCE');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "lastTrackingSelectionReason" "TrackingSelectionReason",
ADD COLUMN     "lastTrackingSourceLabel" TEXT,
ADD COLUMN     "lastTrackingSourceRecordedAt" TIMESTAMP(3),
ADD COLUMN     "lastTrackingSourceStatus" "TrackingSourceStatus",
ADD COLUMN     "lastTrackingSourceType" "TrackingSourceType";

-- CreateTable
CREATE TABLE "GpsDevice" (
    "id" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "serialNumber" TEXT,
    "displayName" TEXT,
    "vendorName" TEXT,
    "modelName" TEXT,
    "imei" TEXT,
    "apiKeyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "lastRecordedAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "lastStatus" "TrackingSourceStatus",
    "lastLat" DECIMAL(10,7),
    "lastLng" DECIMAL(10,7),
    "lastSpeedKmh" DECIMAL(6,2),
    "lastHeading" INTEGER,
    "lastAccuracyM" DECIMAL(8,2),

    CONSTRAINT "GpsDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusGpsDeviceAssignment" (
    "id" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "gpsDeviceId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "BusGpsDeviceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalTrackingState" (
    "id" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "tripId" TEXT,
    "selectedSourceType" "TrackingSourceType" NOT NULL,
    "selectedSourceStatus" "TrackingSourceStatus" NOT NULL,
    "selectionReason" "TrackingSelectionReason" NOT NULL,
    "selectedSourceLabel" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "speedKmh" DECIMAL(6,2),
    "rawSpeedKmh" DECIMAL(6,2),
    "averageSpeedKmh" DECIMAL(6,2),
    "displaySpeedKmh" DECIMAL(6,2),
    "heading" INTEGER,
    "accuracyM" DECIMAL(8,2),
    "recordedAt" TIMESTAMP(3),
    "isStationary" BOOLEAN NOT NULL DEFAULT false,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "distanceDeltaMeters" DECIMAL(10,2),
    "elapsedSeconds" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalTrackingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceTrackingState" (
    "id" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "tripId" TEXT,
    "sourceType" "TrackingSourceType" NOT NULL,
    "sourceStatus" "TrackingSourceStatus" NOT NULL,
    "sourceLabel" TEXT,
    "driverId" TEXT,
    "gpsDeviceId" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "speedKmh" DECIMAL(6,2),
    "rawSpeedKmh" DECIMAL(6,2),
    "averageSpeedKmh" DECIMAL(6,2),
    "displaySpeedKmh" DECIMAL(6,2),
    "heading" INTEGER,
    "accuracyM" DECIMAL(8,2),
    "recordedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "healthScore" INTEGER NOT NULL DEFAULT 0,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "priorityRank" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceTrackingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceIngestLog" (
    "id" TEXT NOT NULL,
    "gpsDeviceId" TEXT NOT NULL,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "speedKmh" DECIMAL(6,2),
    "heading" INTEGER,
    "accuracyM" DECIMAL(8,2),
    "recordedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp" TEXT,
    "isAccepted" BOOLEAN NOT NULL DEFAULT false,
    "sourceStatus" "TrackingSourceStatus",
    "rawPayload" JSONB,
    "notes" TEXT,

    CONSTRAINT "DeviceIngestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GpsDevice_deviceCode_key" ON "GpsDevice"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "GpsDevice_serialNumber_key" ON "GpsDevice"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GpsDevice_imei_key" ON "GpsDevice"("imei");

-- CreateIndex
CREATE INDEX "GpsDevice_isActive_idx" ON "GpsDevice"("isActive");

-- CreateIndex
CREATE INDEX "GpsDevice_lastSeenAt_idx" ON "GpsDevice"("lastSeenAt");

-- CreateIndex
CREATE INDEX "GpsDevice_lastStatus_idx" ON "GpsDevice"("lastStatus");

-- CreateIndex
CREATE INDEX "BusGpsDeviceAssignment_busId_idx" ON "BusGpsDeviceAssignment"("busId");

-- CreateIndex
CREATE INDEX "BusGpsDeviceAssignment_gpsDeviceId_idx" ON "BusGpsDeviceAssignment"("gpsDeviceId");

-- CreateIndex
CREATE INDEX "BusGpsDeviceAssignment_isActive_idx" ON "BusGpsDeviceAssignment"("isActive");

-- CreateIndex
CREATE INDEX "BusGpsDeviceAssignment_unassignedAt_idx" ON "BusGpsDeviceAssignment"("unassignedAt");

-- CreateIndex
CREATE INDEX "CanonicalTrackingState_tripId_idx" ON "CanonicalTrackingState"("tripId");

-- CreateIndex
CREATE INDEX "CanonicalTrackingState_selectedSourceType_idx" ON "CanonicalTrackingState"("selectedSourceType");

-- CreateIndex
CREATE INDEX "CanonicalTrackingState_selectedSourceStatus_idx" ON "CanonicalTrackingState"("selectedSourceStatus");

-- CreateIndex
CREATE INDEX "CanonicalTrackingState_recordedAt_idx" ON "CanonicalTrackingState"("recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalTrackingState_busId_key" ON "CanonicalTrackingState"("busId");

-- CreateIndex
CREATE INDEX "SourceTrackingState_tripId_idx" ON "SourceTrackingState"("tripId");

-- CreateIndex
CREATE INDEX "SourceTrackingState_sourceType_idx" ON "SourceTrackingState"("sourceType");

-- CreateIndex
CREATE INDEX "SourceTrackingState_sourceStatus_idx" ON "SourceTrackingState"("sourceStatus");

-- CreateIndex
CREATE INDEX "SourceTrackingState_gpsDeviceId_idx" ON "SourceTrackingState"("gpsDeviceId");

-- CreateIndex
CREATE INDEX "SourceTrackingState_driverId_idx" ON "SourceTrackingState"("driverId");

-- CreateIndex
CREATE INDEX "SourceTrackingState_isSelected_idx" ON "SourceTrackingState"("isSelected");

-- CreateIndex
CREATE INDEX "SourceTrackingState_lastSeenAt_idx" ON "SourceTrackingState"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceTrackingState_busId_sourceType_key" ON "SourceTrackingState"("busId", "sourceType");

-- CreateIndex
CREATE INDEX "DeviceIngestLog_gpsDeviceId_idx" ON "DeviceIngestLog"("gpsDeviceId");

-- CreateIndex
CREATE INDEX "DeviceIngestLog_recordedAt_idx" ON "DeviceIngestLog"("recordedAt");

-- CreateIndex
CREATE INDEX "DeviceIngestLog_receivedAt_idx" ON "DeviceIngestLog"("receivedAt");

-- CreateIndex
CREATE INDEX "DeviceIngestLog_isAccepted_idx" ON "DeviceIngestLog"("isAccepted");

-- CreateIndex
CREATE INDEX "Trip_lastTrackingSourceType_idx" ON "Trip"("lastTrackingSourceType");

-- CreateIndex
CREATE INDEX "Trip_lastTrackingSourceStatus_idx" ON "Trip"("lastTrackingSourceStatus");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- AddForeignKey
ALTER TABLE "BusGpsDeviceAssignment" ADD CONSTRAINT "BusGpsDeviceAssignment_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusGpsDeviceAssignment" ADD CONSTRAINT "BusGpsDeviceAssignment_gpsDeviceId_fkey" FOREIGN KEY ("gpsDeviceId") REFERENCES "GpsDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalTrackingState" ADD CONSTRAINT "CanonicalTrackingState_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalTrackingState" ADD CONSTRAINT "CanonicalTrackingState_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceTrackingState" ADD CONSTRAINT "SourceTrackingState_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceTrackingState" ADD CONSTRAINT "SourceTrackingState_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceTrackingState" ADD CONSTRAINT "SourceTrackingState_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceTrackingState" ADD CONSTRAINT "SourceTrackingState_gpsDeviceId_fkey" FOREIGN KEY ("gpsDeviceId") REFERENCES "GpsDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIngestLog" ADD CONSTRAINT "DeviceIngestLog_gpsDeviceId_fkey" FOREIGN KEY ("gpsDeviceId") REFERENCES "GpsDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
