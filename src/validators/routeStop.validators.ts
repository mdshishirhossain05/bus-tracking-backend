import { z } from "zod";

const routeStopInputSchema = z.object({
  stopId: z.string().uuid(),
  stopOrder: z.number().int().positive(),
});

export const setRouteStopsSchema = z
  .object({
    stops: z.array(routeStopInputSchema),
  })
  .superRefine((value, ctx) => {
    const stopOrders = new Set<number>();
    const stopIds = new Set<string>();

    const sorted = [...value.stops].sort((a, b) => a.stopOrder - b.stopOrder);

    if (sorted.length === 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A route must have either 0 stops or at least 2 stops.",
        path: ["stops"],
      });
    }

    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      if (!current) continue;

      const expectedOrder = i + 1;

      if (stopOrders.has(current.stopOrder)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate stop order detected: ${current.stopOrder}.`,
          path: ["stops"],
        });
      }

      if (stopIds.has(current.stopId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The same stop cannot be assigned twice in one route.",
          path: ["stops"],
        });
      }

      if (current.stopOrder !== expectedOrder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Stop order must start from 1 and remain continuous without gaps.",
          path: ["stops"],
        });
      }

      stopOrders.add(current.stopOrder);
      stopIds.add(current.stopId);
    }
  });
