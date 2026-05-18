import { z } from "zod";

const roleEnum = z.enum(["ADMIN", "DRIVER", "PASSENGER"]);
const approvalEnum = z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED"]);
const sourceEnum = z.enum(["ADMIN", "SELF"]);

export const listAdminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  role: roleEnum.optional(),
  isActive: z
    .union([z.literal("true"), z.literal("false")])
    .transform((value) => value === "true")
    .optional(),
  approvalStatus: approvalEnum.optional(),
  registrationSource: sourceEnum.optional(),
  academicDepartment: z.string().trim().max(120).optional(),
  academicBatch: z.string().trim().max(120).optional(),
});

export const createAdminUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(128),
  role: roleEnum,
  isActive: z.boolean().optional().default(true),
  studentId: z.string().trim().min(3).max(64).optional(),
  phoneNumber: z
    .string()
    .trim()
    .min(7)
    .max(32)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const updateAdminUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((v) => v.toLowerCase())
    .optional(),
  studentId: z.string().trim().min(3).max(64).optional(),
  phoneNumber: z
    .string()
    .trim()
    .min(7)
    .max(32)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const updateAdminUserRoleSchema = z.object({
  role: roleEnum,
});

export const updateAdminUserStatusSchema = z.object({
  isActive: z.boolean(),
});

export const approvePassengerSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const rejectPassengerSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const updateRegistrationSettingsSchema = z.object({
  passengerSelfRegistrationEnabled: z.boolean(),
});

export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;
export type UpdateAdminUserRoleInput = z.infer<
  typeof updateAdminUserRoleSchema
>;
export type UpdateAdminUserStatusInput = z.infer<
  typeof updateAdminUserStatusSchema
>;
export type ApprovePassengerInput = z.infer<typeof approvePassengerSchema>;
export type RejectPassengerInput = z.infer<typeof rejectPassengerSchema>;
export type UpdateRegistrationSettingsInput = z.infer<
  typeof updateRegistrationSettingsSchema
>;
