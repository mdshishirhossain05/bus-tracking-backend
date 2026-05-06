-- CreateEnum
CREATE TYPE "TripActivationMode" AS ENUM ('MANUAL_DRIVER', 'AUTO_TELEMATICS', 'MANUAL_ADMIN');

-- AlterTable
ALTER TABLE "Trip"
ADD COLUMN "activationMode" "TripActivationMode" NOT NULL DEFAULT 'MANUAL_DRIVER',
ADD COLUMN "startedByGpsDeviceId" TEXT;

-- CreateIndex
CREATE INDEX "Trip_activationMode_idx" ON "Trip"("activationMode");

-- CreateIndex
CREATE INDEX "Trip_startedByGpsDeviceId_idx" ON "Trip"("startedByGpsDeviceId");

-- AddForeignKey
ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_startedByGpsDeviceId_fkey"
FOREIGN KEY ("startedByGpsDeviceId") REFERENCES "GpsDevice"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
