-- AlterTable
-- Additive boolean with a default. Existing rows take the default (false).
-- Metadata-only on PostgreSQL — no table rewrite.
ALTER TABLE "Trip" ADD COLUMN "autoEndDisabled" BOOLEAN NOT NULL DEFAULT false;
