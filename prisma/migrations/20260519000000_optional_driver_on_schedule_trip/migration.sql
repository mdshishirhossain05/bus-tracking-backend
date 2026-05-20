-- AlterTable: make driverId optional on ServiceSchedule and Trip so buses
-- with an assigned GPS device can run schedules / trips without a driver.
ALTER TABLE "ServiceSchedule" ALTER COLUMN "driverId" DROP NOT NULL;
ALTER TABLE "Trip" ALTER COLUMN "driverId" DROP NOT NULL;
