import { z } from "zod";

export const createRouteSchema = z.object({
  routeName: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});

export const updateRouteSchema = createRouteSchema.partial();
