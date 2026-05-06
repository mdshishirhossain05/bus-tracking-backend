import { z } from "zod";

export const createBusSchema = z.object({
  busCode: z.string().min(2).max(50),
  plateNumber: z.string().min(3).max(50).optional(),
  capacity: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export const updateBusSchema = createBusSchema.partial();
