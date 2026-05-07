import { z } from "zod";

const strongPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must not exceed 128 characters.")
  .regex(/[a-z]/, "Password must include at least one lowercase letter.")
  .regex(/[A-Z]/, "Password must include at least one uppercase letter.")
  .regex(/[0-9]/, "Password must include at least one number.")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must include at least one special character.",
  );

export const requestPassengerRegistrationOtpSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Please enter a valid email address.")
    .max(255)
    .transform((v) => v.toLowerCase()),
});

export const verifyPassengerRegistrationOtpSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Please enter a valid email address.")
    .max(255)
    .transform((v) => v.toLowerCase()),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "OTP must be a 6-digit code."),
});

export const registerPassengerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((v) => v.toLowerCase()),
  password: strongPasswordSchema,
  studentId: z.string().trim().min(3).max(64),
  phoneNumber: z
    .string()
    .trim()
    .min(7)
    .max(32)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  emailVerificationToken: z.string().trim().min(32).max(256),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(6),
});

export const updateMeSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((v) => v.toLowerCase()),
  phoneNumber: z
    .string()
    .trim()
    .min(7)
    .max(32)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6),
    newPassword: strongPasswordSchema,
    confirmNewPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "New password and confirmation must match",
  });
