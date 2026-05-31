-- CreateEnum
CREATE TYPE "OccupancyLevel" AS ENUM ('LIGHT', 'MODERATE', 'FULL');

-- CreateEnum
CREATE TYPE "ServiceAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "RouteVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "tripId" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,

    CONSTRAINT "RouteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteVisit_userId_visitedAt_idx"
ON "RouteVisit"("userId", "visitedAt");

-- CreateIndex
CREATE INDEX "RouteVisit_routeId_idx" ON "RouteVisit"("routeId");

-- CreateIndex
CREATE INDEX "RouteVisit_tripId_idx" ON "RouteVisit"("tripId");

-- AddForeignKey
ALTER TABLE "RouteVisit"
ADD CONSTRAINT "RouteVisit_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteVisit"
ADD CONSTRAINT "RouteVisit_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "Route"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteVisit"
ADD CONSTRAINT "RouteVisit_tripId_fkey"
FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "OccupancyVote" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "OccupancyLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OccupancyVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OccupancyVote_tripId_userId_key"
ON "OccupancyVote"("tripId", "userId");

-- CreateIndex
CREATE INDEX "OccupancyVote_tripId_idx" ON "OccupancyVote"("tripId");

-- AddForeignKey
ALTER TABLE "OccupancyVote"
ADD CONSTRAINT "OccupancyVote_tripId_fkey"
FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupancyVote"
ADD CONSTRAINT "OccupancyVote_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ServiceAlert" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "ServiceAlertSeverity" NOT NULL DEFAULT 'INFO',
    "routeId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "ServiceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceAlert_isActive_validFrom_validUntil_idx"
ON "ServiceAlert"("isActive", "validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "ServiceAlert_routeId_idx" ON "ServiceAlert"("routeId");

-- AddForeignKey
ALTER TABLE "ServiceAlert"
ADD CONSTRAINT "ServiceAlert_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "Route"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAlert"
ADD CONSTRAINT "ServiceAlert_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
