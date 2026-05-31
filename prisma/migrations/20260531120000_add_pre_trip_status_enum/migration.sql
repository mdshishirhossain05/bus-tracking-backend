-- ALTER TYPE ... ADD VALUE cannot run inside a transaction with other DDL on
-- the same enum in PostgreSQL, so the enum extension lives in its own
-- migration ahead of the columns that reference it.
ALTER TYPE "TripStatus" ADD VALUE 'PRE_TRIP' BEFORE 'RUNNING';
