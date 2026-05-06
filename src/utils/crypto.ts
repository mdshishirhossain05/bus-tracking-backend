import crypto from "node:crypto";

export function randomId(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashUserAgent(ua: string): string {
  return sha256(ua || "unknown");
}

export function uuid(): string {
  return crypto.randomUUID();
}
