import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/appError.js";

export type NotificationPreferences = {
  notificationsEnabled: boolean;
  quietHoursStartMin: number | null;
  quietHoursEndMin: number | null;
};

export async function getNotificationPreferencesService(
  userId: string,
): Promise<NotificationPreferences> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      notificationsEnabled: true,
      quietHoursStartMin: true,
      quietHoursEndMin: true,
    },
  });
  if (!user) {
    throw new AppError({
      statusCode: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  }
  return {
    notificationsEnabled: user.notificationsEnabled,
    quietHoursStartMin: user.quietHoursStartMin,
    quietHoursEndMin: user.quietHoursEndMin,
  };
}

export type UpdateNotificationPreferencesInput = Partial<NotificationPreferences>;

function validateMinute(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 1439) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_QUIET_HOURS",
      message: "Quiet hours minutes must be integers in 0..1439",
    });
  }
  return value;
}

export async function updateNotificationPreferencesService(
  userId: string,
  input: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferences> {
  const data: Record<string, unknown> = {};

  if (input.notificationsEnabled !== undefined) {
    data.notificationsEnabled = Boolean(input.notificationsEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(input, "quietHoursStartMin")) {
    data.quietHoursStartMin = validateMinute(input.quietHoursStartMin);
  }
  if (Object.prototype.hasOwnProperty.call(input, "quietHoursEndMin")) {
    data.quietHoursEndMin = validateMinute(input.quietHoursEndMin);
  }

  // Quiet hours must be set as a pair: either both null (disabled) or both
  // present. We treat "one set, one null" as the user clearing the range.
  if (data.quietHoursStartMin === null) data.quietHoursEndMin = null;
  if (data.quietHoursEndMin === null) data.quietHoursStartMin = null;

  await prisma.user.update({ where: { id: userId }, data });

  return getNotificationPreferencesService(userId);
}

/**
 * Returns true if `now` (a UTC instant) falls within the user's quiet
 * hours window. The window is stored in *minutes since local midnight*
 * (Dhaka, UTC+6) and may wrap (e.g. start=1320 (22:00) end=420 (07:00)).
 */
export function isInQuietHours(
  prefs: NotificationPreferences,
  now: Date,
): boolean {
  if (prefs.quietHoursStartMin == null || prefs.quietHoursEndMin == null) {
    return false;
  }

  // Local minutes since midnight, computed in Asia/Dhaka (UTC+6). The
  // codebase doesn't pull in a TZ lib for the hot paths; we hard-code the
  // BD offset, same convention as `arrival.service.ts`.
  const DHAKA_OFFSET_MIN = 6 * 60;
  const dhakaMs = now.getTime() + DHAKA_OFFSET_MIN * 60_000;
  const d = new Date(dhakaMs);
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();

  const { quietHoursStartMin: start, quietHoursEndMin: end } = prefs;
  if (start === end) return false;

  if (start < end) {
    return minute >= start && minute < end;
  }
  // Wraparound (e.g. 22:00 → 07:00)
  return minute >= start || minute < end;
}
