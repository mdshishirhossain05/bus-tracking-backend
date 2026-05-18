-- AlterTable
-- Additive, nullable columns. Existing rows remain valid (NULL). No table
-- rewrite or long lock on PostgreSQL: adding a NULL column with no default
-- is a metadata-only, instant operation.
ALTER TABLE "User" ADD COLUMN     "academicDepartment" TEXT,
ADD COLUMN     "academicBatch" TEXT,
ADD COLUMN     "transportPickupPoint" TEXT;
