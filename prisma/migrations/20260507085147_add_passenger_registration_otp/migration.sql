/*
  Warnings:

  - A unique constraint covering the columns `[traccarDeviceId]` on the table `GpsDevice` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[traccarUniqueId]` on the table `GpsDevice` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[studentId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "UserApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UserRegistrationSource" AS ENUM ('ADMIN', 'SELF');

-- CreateEnum
CREATE TYPE "TraccarSyncStatus" AS ENUM ('UNLINKED', 'LINKED', 'SYNCED', 'ERROR');

-- AlterTable
ALTER TABLE "GpsDevice" ADD COLUMN     "traccarDeviceId" INTEGER,
ADD COLUMN     "traccarLastError" TEXT,
ADD COLUMN     "traccarLastSyncAt" TIMESTAMP(3),
ADD COLUMN     "traccarManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "traccarServerBaseUrl" TEXT,
ADD COLUMN     "traccarSyncStatus" "TraccarSyncStatus" NOT NULL DEFAULT 'UNLINKED',
ADD COLUMN     "traccarUniqueId" TEXT;

-- AlterTable
ALTER TABLE "RouteGeometry" ADD COLUMN     "distanceKm" DECIMAL(10,3),
ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approvalStatus" "UserApprovalStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "registrationSource" "UserRegistrationSource" NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedByUserId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "studentId" TEXT;

-- CreateTable
CREATE TABLE "EmailVerificationOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PASSENGER_REGISTRATION',
    "otpHash" TEXT NOT NULL,
    "verificationTokenHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailVerificationOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "passengerSelfRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailVerificationOtp_email_purpose_idx" ON "EmailVerificationOtp"("email", "purpose");

-- CreateIndex
CREATE INDEX "EmailVerificationOtp_expiresAt_idx" ON "EmailVerificationOtp"("expiresAt");

-- CreateIndex
CREATE INDEX "EmailVerificationOtp_verificationTokenHash_idx" ON "EmailVerificationOtp"("verificationTokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationOtp_consumedAt_idx" ON "EmailVerificationOtp"("consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GpsDevice_traccarDeviceId_key" ON "GpsDevice"("traccarDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "GpsDevice_traccarUniqueId_key" ON "GpsDevice"("traccarUniqueId");

-- CreateIndex
CREATE INDEX "GpsDevice_traccarManaged_idx" ON "GpsDevice"("traccarManaged");

-- CreateIndex
CREATE INDEX "GpsDevice_traccarSyncStatus_idx" ON "GpsDevice"("traccarSyncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_approvalStatus_idx" ON "User"("approvalStatus");

-- CreateIndex
CREATE INDEX "User_registrationSource_idx" ON "User"("registrationSource");
