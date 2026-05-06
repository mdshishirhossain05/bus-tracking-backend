-- CreateEnum
CREATE TYPE "ServiceDayType" AS ENUM ('WEEKDAY', 'WEEKEND');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "serviceScheduleId" TEXT;

-- CreateTable
CREATE TABLE "ServiceSchedule" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "dayType" "ServiceDayType" NOT NULL,
    "departureTime" TIME(0) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceSchedule_routeId_idx" ON "ServiceSchedule"("routeId");

-- CreateIndex
CREATE INDEX "ServiceSchedule_busId_idx" ON "ServiceSchedule"("busId");

-- CreateIndex
CREATE INDEX "ServiceSchedule_driverId_idx" ON "ServiceSchedule"("driverId");

-- CreateIndex
CREATE INDEX "ServiceSchedule_dayType_departureTime_idx" ON "ServiceSchedule"("dayType", "departureTime");

-- CreateIndex
CREATE INDEX "ServiceSchedule_isActive_idx" ON "ServiceSchedule"("isActive");

-- CreateIndex
CREATE INDEX "Bus_isActive_idx" ON "Bus"("isActive");

-- CreateIndex
CREATE INDEX "Route_isActive_idx" ON "Route"("isActive");

-- CreateIndex
CREATE INDEX "Trip_serviceScheduleId_idx" ON "Trip"("serviceScheduleId");

-- AddForeignKey
ALTER TABLE "ServiceSchedule" ADD CONSTRAINT "ServiceSchedule_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSchedule" ADD CONSTRAINT "ServiceSchedule_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSchedule" ADD CONSTRAINT "ServiceSchedule_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_serviceScheduleId_fkey" FOREIGN KEY ("serviceScheduleId") REFERENCES "ServiceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
