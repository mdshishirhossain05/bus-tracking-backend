import { z } from "zod";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const scheduleDayTypeEnum = z.enum([
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
]);

export const createScheduleSchema = z.object({
  routeId: z.string().uuid(),
  stopId: z.string().uuid(),
  dayType: scheduleDayTypeEnum,
  scheduledTime: z.string().regex(timeRegex, "Use HH:mm or HH:mm:ss format"),
});

export const updateScheduleSchema = z.object({
  routeId: z.string().uuid().optional(),
  stopId: z.string().uuid().optional(),
  dayType: scheduleDayTypeEnum.optional(),
  scheduledTime: z
    .string()
    .regex(timeRegex, "Use HH:mm or HH:mm:ss format")
    .optional(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
