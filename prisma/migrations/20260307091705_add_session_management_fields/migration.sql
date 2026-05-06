-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deviceLabel" TEXT,
ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSeenIp" TEXT,
ADD COLUMN     "revokedReason" TEXT,
ADD COLUMN     "userAgentRaw" TEXT;
