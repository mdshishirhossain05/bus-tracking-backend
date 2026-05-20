-- AlterTable: track the driver's explicit tracking-source choice when they
-- manually start a trip on a bus that also has a GPS device. Null means no
-- explicit preference (auto-arbitrated). Additive; no row rewrite needed.
ALTER TABLE "Trip" ADD COLUMN "preferredTrackingSourceType" "TrackingSourceType";
