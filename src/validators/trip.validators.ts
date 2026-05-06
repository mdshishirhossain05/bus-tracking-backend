import { z } from "zod";

export const startTripSchema = z.object({
  busId: z.string().uuid(),
  routeId: z.string().uuid(),
});

export const locationUpdateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(300).optional(),
  heading: z.number().int().min(0).max(360).optional(),
  accuracyM: z.number().min(0).max(5000).optional(),
  recordedAt: z.string().datetime().optional(),
});
