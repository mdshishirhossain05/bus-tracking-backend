import { z } from "zod";

const stopCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Stop code may only contain letters, numbers, _ and -",
  );

export const createStopSchema = z.object({
  stopName: z.string().trim().min(2).max(120),
  stopCode: stopCodeSchema.optional(),
  landmark: z.string().trim().max(160).optional().or(z.literal("")),
  address: z.string().trim().max(255).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const updateStopSchema = createStopSchema.partial();
