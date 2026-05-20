import { z } from "zod";

export const startTripSchema = z.object({
  busId: z.string().uuid(),
  routeId: z.string().uuid(),
});

// Optional body the driver client sends when starting a trip on a bus that
// also has a GPS device — lets the driver pick which source to track with.
// Omitted means "no explicit preference" (existing default behaviour).
export const startTripBodySchema = z.object({
  preferredSourceType: z.enum(["DRIVER_MOBILE", "GPS_DEVICE"]).optional(),
});

export const locationUpdateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(300).optional(),
  heading: z.number().int().min(0).max(360).optional(),
  accuracyM: z.number().min(0).max(5000).optional(),
  recordedAt: z.string().datetime().optional(),
});
