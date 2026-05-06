import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";

export type AccessTokenPayload = {
  userId: string;
  role: UserRole;
  sessionId: string;
  type: "access";
};

export type RefreshTokenPayload = {
  userId: string;
  role: UserRole;
  sessionId: string;
  familyId: string;
  tokenId: string;
  type: "refresh";
};

type JwtExpiresIn = NonNullable<jwt.SignOptions["expiresIn"]>;

function mustGet(name: string): string | undefined {
  const v = process.env[name];
  if (v && v.trim().length > 0) return v;
  return undefined;
}

function getAccessSecret(): string {
  return (
    mustGet("JWT_ACCESS_SECRET") ??
    mustGet("JWT_SECRET") ??
    (() => {
      throw new Error(
        "JWT_ACCESS_SECRET (or JWT_SECRET fallback) missing in env",
      );
    })()
  );
}

function getRefreshSecret(): string {
  return (
    mustGet("JWT_REFRESH_SECRET") ??
    mustGet("JWT_SECRET") ??
    (() => {
      throw new Error(
        "JWT_REFRESH_SECRET (or JWT_SECRET fallback) missing in env",
      );
    })()
  );
}

function getExpires(name: string, fallback: JwtExpiresIn): JwtExpiresIn {
  const v = process.env[name];
  return v && v.trim().length > 0 ? (v as JwtExpiresIn) : fallback;
}

export function signAccessToken(
  payload: Omit<AccessTokenPayload, "type">,
): string {
  const expiresIn = getExpires("ACCESS_TOKEN_EXPIRES_IN", "15m");

  return jwt.sign({ ...payload, type: "access" }, getAccessSecret(), {
    expiresIn,
  });
}

export function signRefreshToken(
  payload: Omit<RefreshTokenPayload, "type">,
): string {
  const expiresIn = getExpires("REFRESH_TOKEN_EXPIRES_IN", "7d");

  return jwt.sign({ ...payload, type: "refresh" }, getRefreshSecret(), {
    expiresIn,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, getAccessSecret()) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, getRefreshSecret()) as RefreshTokenPayload;
}
