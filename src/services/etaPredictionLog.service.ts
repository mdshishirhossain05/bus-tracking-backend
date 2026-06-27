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
