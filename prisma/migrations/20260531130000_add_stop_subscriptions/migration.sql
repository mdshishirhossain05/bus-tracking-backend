-- AlterTable
ALTER TABLE "User"
ADD COLUMN "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "quietHoursStartMin" INTEGER,
ADD COLUMN "quietHoursEndMin" INTEGER;

-- CreateTable
CREATE TABLE "StopSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "leadTimeMinutes" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StopSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StopSubscription_userId_stopId_routeId_key"
ON "StopSubscription"("userId", "stopId", "routeId");

-- CreateIndex
CREATE INDEX "StopSubscription_userId_idx" ON "StopSubscription"("userId");

-- CreateIndex
CREATE INDEX "StopSubscription_routeId_stopId_enabled_idx"
ON "StopSubscription"("routeId", "stopId", "enabled");

-- AddForeignKey
ALTER TABLE "StopSubscription"
ADD CONSTRAINT "StopSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopSubscription"
ADD CONSTRAINT "StopSubscription_stopId_fkey"
FOREIGN KEY ("stopId") REFERENCES "Stop"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopSubscription"
ADD CONSTRAINT "StopSubscription_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "Route"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
