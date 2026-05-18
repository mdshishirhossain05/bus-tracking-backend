import { z } from "zod";

export const delayReportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  routeId: z.string().trim().uuid().optional(),
});

export type DelayReportQuery = z.infer<typeof delayReportQuerySchema>;
