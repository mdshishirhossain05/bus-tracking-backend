/*
  Warnings:

  - The values [WEEKDAY,WEEKEND] on the enum `DayType` will be removed. If these variants are still used in the database, this will fail.
  - The values [WEEKDAY,WEEKEND] on the enum `ServiceDayType` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[stopCode]` on the table `Stop` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "DayType_new" AS ENUM ('SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY');
ALTER TABLE "Schedule" ALTER COLUMN "dayType" TYPE "DayType_new" USING ("dayType"::text::"DayType_new");
ALTER TYPE "DayType" RENAME TO "DayType_old";
ALTER TYPE "DayType_new" RENAME TO "DayType";
DROP TYPE "public"."DayType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ServiceDayType_new" AS ENUM ('SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY');
ALTER TABLE "ServiceSchedule" ALTER COLUMN "dayType" TYPE "ServiceDayType_new" USING ("dayType"::text::"ServiceDayType_new");
ALTER TYPE "ServiceDayType" RENAME TO "ServiceDayType_old";
ALTER TYPE "ServiceDayType_new" RENAME TO "ServiceDayType";
DROP TYPE "public"."ServiceDayType_old";
COMMIT;

-- AlterTable
ALTER TABLE "Stop" ADD COLUMN     "address" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "stopCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Stop_stopCode_key" ON "Stop"("stopCode");

-- CreateIndex
CREATE INDEX "Stop_stopCode_idx" ON "Stop"("stopCode");

-- CreateIndex
CREATE INDEX "Stop_isActive_idx" ON "Stop"("isActive");
