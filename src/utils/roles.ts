export const ROLES = {
  ADMIN: "ADMIN",
  DRIVER: "DRIVER",
  PASSENGER: "PASSENGER",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
