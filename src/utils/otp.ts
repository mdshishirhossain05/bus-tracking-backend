import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env.js";

/**
 * Keyed SHA-256 hash used to store OTP / verification-token secrets at rest.
 * The JWT access secret acts as a server-side pepper.
 */
export function hashSecret(value: string) {
  return createHash("sha256")
    .update(`${value}:${env.JWT_ACCESS_SECRET}`, "utf8")
    .digest("hex");
}

/** Generates a 6-digit numeric OTP. */
export function generateOtp() {
  return String(randomInt(100000, 1000000));
}

/** Generates a 64-character hex single-use verification token. */
export function generateVerificationToken() {
  return randomBytes(32).toString("hex");
}

/** Constant-time comparison of two hex-encoded hashes. */
export function safeHashCompare(leftHash: string, rightHash: string) {
  const left = Buffer.from(leftHash, "hex");
  const right = Buffer.from(rightHash, "hex");

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}
