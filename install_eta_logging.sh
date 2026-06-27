#!/usr/bin/env bash
# =====================================================================
# UniBus Live — ETA-prediction logging patch (for paper evaluation)
#
# Adds a lightweight, fire-and-forget logger that records every ETA the
# server predicts, so you can later compute real predicted-vs-actual
# ETA error against StopArrival.
#
# Idempotent: safe to run more than once.
#
# RUN ON THE VPS:
#   cd /opt/bus-tracking-backend
#   bash install_eta_logging.sh
# =====================================================================
set -e
APP=/opt/bus-tracking-backend
cd "$APP"

echo "==> 1/5  Creating EtaPrediction table"
sudo -u postgres psql -d nrtech311_bus <<'SQL'
CREATE TABLE IF NOT EXISTS "EtaPrediction" (
  id                    TEXT PRIMARY KEY,
  "tripId"              TEXT NOT NULL,
  "stopId"              TEXT NOT NULL,
  "predictedEtaMinutes" DOUBLE PRECISION NOT NULL,
  "predictedAt"         TIMESTAMP(3) NOT NULL,
  "predictedArrivalAt"  TIMESTAMP(3) NOT NULL,
  confidence            TEXT
);
CREATE INDEX IF NOT EXISTS "EtaPrediction_tripId_idx"      ON "EtaPrediction"("tripId");
CREATE INDEX IF NOT EXISTS "EtaPrediction_stopId_idx"      ON "EtaPrediction"("stopId");
CREATE INDEX IF NOT EXISTS "EtaPrediction_predictedAt_idx" ON "EtaPrediction"("predictedAt");
SQL

echo "==> 2/5  Writing src/services/etaPredictionLog.service.ts"
cat > src/services/etaPredictionLog.service.ts <<'TS'
import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import type { EtaResult } from "./eta.service.js";

/**
 * Best-effort logging of ETA predictions for offline accuracy evaluation.
 * For each upcoming stop with a finite ETA we store the predicted arrival
 * instant so it can later be compared against the real StopArrival row.
 * Fire-and-forget: never blocks or fails the live ETA path.
 */
export function logEtaPredictions(params: {
  tripId: string;
  eta: EtaResult;
  predictedAt: Date;
}): void {
  const { tripId, eta, predictedAt } = params;
  void (async () => {
    try {
      for (const s of eta.stopEtas) {
        if (s.etaMinutes == null || !Number.isFinite(s.etaMinutes)) continue;
        const predictedArrivalAt = new Date(
          predictedAt.getTime() + s.etaMinutes * 60_000,
        );
        await prisma.$executeRaw`
          INSERT INTO "EtaPrediction"
            (id, "tripId", "stopId", "predictedEtaMinutes",
             "predictedAt", "predictedArrivalAt", confidence)
          VALUES
            (${randomUUID()}, ${tripId}, ${s.stopId}, ${s.etaMinutes},
             ${predictedAt}, ${predictedArrivalAt}, ${eta.confidence})
        `;
      }
    } catch {
      // analytics only — ignore failures
    }
  })();
}
TS

echo "==> 3/5  Wiring it into driverLocation.service.ts"
DLS=src/services/driverLocation.service.ts
# add the import (once)
if ! grep -q "etaPredictionLog.service.js" "$DLS"; then
  sed -i '/import { triggerStopApproachAlertsService } from ".\/stopAlerts.service.js";/a import { logEtaPredictions } from "./etaPredictionLog.service.js";' "$DLS"
fi
# add the call just before the "Smart stop-approach pushes" comment (once)
if ! grep -q "logEtaPredictions({ tripId, eta" "$DLS"; then
  sed -i '/Smart stop-approach pushes/i\  logEtaPredictions({ tripId, eta, predictedAt: updatedAt });' "$DLS"
fi
echo "    import wired:  $(grep -c etaPredictionLog.service.js "$DLS")   (expect 1)"
echo "    call wired:    $(grep -c 'logEtaPredictions({ tripId, eta' "$DLS")   (expect 1)"

echo "==> 4/5  Building (prisma generate + tsc)"
npm run build

echo "==> 5/5  Restarting service"
systemctl restart bus-backend
sleep 5
echo "    service: $(systemctl is-active bus-backend)"

echo ""
echo "DONE. The server is now logging ETA predictions."
echo "Let it collect data over real trips for ~1 week, then run:"
echo "    sudo -u postgres psql -d nrtech311_bus -f eta_accuracy_eval.sql"
echo ""
echo "To save this change in your GitHub repo (optional but recommended):"
echo "    git add -A && git commit -m 'add ETA-prediction logging for evaluation'"
echo "    git push    # will prompt: username = mdshishirhossain05, password = your PAT"
