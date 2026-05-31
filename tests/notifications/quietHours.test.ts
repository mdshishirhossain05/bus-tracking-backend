import { describe, test, expect } from "vitest";
import { isInQuietHours } from "../../src/services/notificationPreferences.service.js";

// Helper: build a UTC Date that lands at the given Dhaka (UTC+6) wall-clock.
function dhakaTimeUtc(hours: number, minutes: number): Date {
  // The service treats `now` as a UTC instant and shifts +360 min to derive
  // Dhaka minutes-since-midnight. So a UTC instant at H-6:MM gives Dhaka H:MM.
  return new Date(Date.UTC(2026, 4, 31, hours - 6, minutes));
}

const ENABLED = { notificationsEnabled: true };

describe("isInQuietHours", () => {
  test("returns false when no quiet hours configured", () => {
    expect(
      isInQuietHours(
        { ...ENABLED, quietHoursStartMin: null, quietHoursEndMin: null },
        dhakaTimeUtc(3, 0),
      ),
    ).toBe(false);
  });

  test("returns false when only one side is set", () => {
    expect(
      isInQuietHours(
        { ...ENABLED, quietHoursStartMin: 1320, quietHoursEndMin: null },
        dhakaTimeUtc(23, 0),
      ),
    ).toBe(false);
  });

  test("daytime window: 08:00–17:00", () => {
    const prefs = {
      ...ENABLED,
      quietHoursStartMin: 8 * 60,
      quietHoursEndMin: 17 * 60,
    };
    expect(isInQuietHours(prefs, dhakaTimeUtc(7, 59))).toBe(false);
    expect(isInQuietHours(prefs, dhakaTimeUtc(8, 0))).toBe(true);
    expect(isInQuietHours(prefs, dhakaTimeUtc(12, 30))).toBe(true);
    expect(isInQuietHours(prefs, dhakaTimeUtc(16, 59))).toBe(true);
    expect(isInQuietHours(prefs, dhakaTimeUtc(17, 0))).toBe(false);
  });

  test("overnight wraparound: 22:00–07:00", () => {
    const prefs = {
      ...ENABLED,
      quietHoursStartMin: 22 * 60,
      quietHoursEndMin: 7 * 60,
    };
    expect(isInQuietHours(prefs, dhakaTimeUtc(21, 59))).toBe(false);
    expect(isInQuietHours(prefs, dhakaTimeUtc(22, 0))).toBe(true);
    expect(isInQuietHours(prefs, dhakaTimeUtc(23, 30))).toBe(true);
    expect(isInQuietHours(prefs, dhakaTimeUtc(0, 5))).toBe(true);
    expect(isInQuietHours(prefs, dhakaTimeUtc(6, 59))).toBe(true);
    expect(isInQuietHours(prefs, dhakaTimeUtc(7, 0))).toBe(false);
    expect(isInQuietHours(prefs, dhakaTimeUtc(12, 0))).toBe(false);
  });

  test("equal start and end means no quiet hours", () => {
    const prefs = { ...ENABLED, quietHoursStartMin: 600, quietHoursEndMin: 600 };
    expect(isInQuietHours(prefs, dhakaTimeUtc(10, 0))).toBe(false);
    expect(isInQuietHours(prefs, dhakaTimeUtc(23, 0))).toBe(false);
  });
});
