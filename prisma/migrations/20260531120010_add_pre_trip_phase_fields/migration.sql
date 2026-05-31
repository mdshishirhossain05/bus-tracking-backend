-- CreateEnum
CREATE TYPE "TripPreTripPhase" AS ENUM ('AT_DEPOT', 'APPROACHING_ORIGIN', 'AT_ORIGIN');

-- AlterTable
ALTER TABLE "Trip"
ADD COLUMN "preTripPhase" "TripPreTripPhase",
ADD COLUMN "preTripStartedAt" TIMESTAMP(3),
ADD COLUMN "originArrivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Trip_preTripPhase_idx" ON "Trip"("preTripPhase");

-- CreateIndex
CREATE INDEX "Trip_serviceScheduleId_status_idx" ON "Trip"("serviceScheduleId", "status");
