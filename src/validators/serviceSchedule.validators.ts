import { z } from "zod";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const serviceDayTypeEnum = z.enum([
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
]);

export const listServiceSchedulesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  routeId: z.string().uuid().optional(),
  busId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  dayType: serviceDayTypeEnum.optional(),
  isActive: z
    .union([z.literal("true"), z.literal("false")])
    .transform((value) => value === "true")
    .optional(),
  search: z.string().trim().optional(),
});

// driverId is optional at the schema level. The schedule service rejects the
// request when no driver is provided AND the bus has no active GPS device
// assignment — so every schedule still has *some* way to be tracked.
export const createServiceScheduleSchema = z.object({
  routeId: z.string().uuid(),
  busId: z.string().uuid(),
  driverId: z.string().uuid().nullable().optional(),
  dayType: serviceDayTypeEnum,
  departureTime: z.string().regex(timeRegex, "Use HH:mm or HH:mm:ss format"),
  isActive: z.boolean().optional().default(true),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const updateServiceScheduleSchema = z.object({
  routeId: z.string().uuid().optional(),
  busId: z.string().uuid().optional(),
  driverId: z.string().uuid().nullable().optional(),
  dayType: serviceDayTypeEnum.optional(),
  departureTime: z
    .string()
    .regex(timeRegex, "Use HH:mm or HH:mm:ss format")
    .optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type ListServiceSchedulesQuery = z.infer<
  typeof listServiceSchedulesQuerySchema
>;
export type CreateServiceScheduleInput = z.infer<
  typeof createServiceScheduleSchema
>;
export type UpdateServiceScheduleInput = z.infer<
  typeof updateServiceScheduleSchema
>;
