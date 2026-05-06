import type { ServiceDayType } from "@prisma/client";

const JS_DAY_TO_DAY_TYPE = {
  0: "SUNDAY",
  1: "MONDAY",
  2: "TUESDAY",
  3: "WEDNESDAY",
  4: "THURSDAY",
  5: "FRIDAY",
  6: "SATURDAY",
} as const satisfies Record<number, ServiceDayType>;

export function getDayTypeForDate(d: Date): ServiceDayType {
  return JS_DAY_TO_DAY_TYPE[d.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6];
}
