import type { Request } from "express";
import type { UserRole } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { hashUserAgent, randomId, sha256, uuid } from "../utils/crypto.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt.js";
import type { RefreshTokenPayload } from "../utils/jwt.js";

function getClientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) return xf.split(",")[0]!.trim();
  return req.ip || "unknown";
}

function getUserAgent(req: Request): string {
  return typeof req.headers["user-agent"] === "string"
    ? req.headers["user-agent"]
    : "";
}

function buildDeviceLabel(userAgentRaw: string): string {
  const ua = userAgentRaw.toLowerCase();

  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("chrome/")
      ? "Chrome"
      : ua.includes("firefox/")
        ? "Firefox"
        : ua.includes("safari/") && !ua.includes("chrome/")
          ? "Safari"
          : ua.includes("opr/") || ua.includes("opera")
            ? "Opera"
            : "Unknown Browser";

  const device = ua.includes("windows")
    ? "Windows"
    : ua.includes("android")
      ? "Android"
      : ua.includes("iphone")
        ? "iPhone"
        : ua.includes("ipad")
          ? "iPad"
          : ua.includes("mac os") || ua.includes("macintosh")
            ? "macOS"
            : ua.includes("linux")
              ? "Linux"
              : "Unknown Device";

  return `${browser} on ${device}`;
}

export type SessionTokenResult = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  userId: string;
  role: UserRole;
  familyId: string;
};

export type RefreshFailureCode =
  | "INVALID_REFRESH"
  | "INVALID_REFRESH_TYPE"
  | "SESSION_NOT_FOUND"
  | "SESSION_REVOKED"
  | "SESSION_USER_MISMATCH"
  | "USER_INACTIVE"
  | "FAMILY_MISMATCH"
  | "REFRESH_REUSE_DETECTED";

export class RefreshTokenError extends Error {
  code: RefreshFailureCode;
  userId: string | undefined;
  sessionId: string | undefined;
  familyId: string | undefined;

  constructor(params: {
    code: RefreshFailureCode;
    message?: string;
    userId?: string;
    sessionId?: string;
    familyId?: string;
  }) {
    super(params.message ?? params.code);
    this.name = "RefreshTokenError";
    this.code = params.code;
    this.userId = params.userId;
    this.sessionId = params.sessionId;
    this.familyId = params.familyId;
  }
}

export async function createSessionAndTokens(params: {
  req: Request;
  userId: string;
  role: UserRole;
}): Promise<SessionTokenResult> {
  const { req, userId, role } = params;

  const sessionId = uuid();
  const familyId = randomId(24);
  const tokenId = randomId(24);

  const ua = getUserAgent(req);
  const ip = getClientIp(req);
  const deviceLabel = buildDeviceLabel(ua);

  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      roleSnapshot: role,
      refreshFamilyId: familyId,
      refreshTokenHash: sha256(tokenId),
      userAgentHash: hashUserAgent(ua),
      userAgentRaw: ua || null,
      deviceLabel,
      ipFirst: ip,
      ipLast: ip,
      lastSeenIp: ip,
      isCurrent: true,
    },
  });

  const accessToken = signAccessToken({ userId, role, sessionId });
  const refreshToken = signRefreshToken({
    userId,
    role,
    sessionId,
    familyId,
    tokenId,
  });

  return {
    accessToken,
    refreshToken,
    sessionId,
    userId,
    role,
    familyId,
  };
}

export async function rotateRefreshToken(params: {
  req: Request;
  refreshToken: string;
}): Promise<SessionTokenResult> {
  const { req, refreshToken } = params;

  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new RefreshTokenError({
      code: "INVALID_REFRESH",
    });
  }

  if (payload.type !== "refresh") {
    throw new RefreshTokenError({
      code: "INVALID_REFRESH_TYPE",
      userId: payload.userId,
      sessionId: payload.sessionId,
      familyId: payload.familyId,
    });
  }

  const { userId, role, sessionId, familyId, tokenId } = payload;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session) {
    throw new RefreshTokenError({
      code: "SESSION_NOT_FOUND",
      userId,
      sessionId,
      familyId,
    });
  }

  if (session.revokedAt) {
    throw new RefreshTokenError({
      code: "SESSION_REVOKED",
      userId,
      sessionId,
      familyId,
    });
  }

  if (session.userId !== userId) {
    throw new RefreshTokenError({
      code: "SESSION_USER_MISMATCH",
      userId,
      sessionId,
      familyId,
    });
  }

  if (!session.user.isActive) {
    await revokeSession(sessionId, "USER_INACTIVE");
    throw new RefreshTokenError({
      code: "USER_INACTIVE",
      userId,
      sessionId,
      familyId,
    });
  }

  if (session.refreshFamilyId !== familyId) {
    await revokeSession(sessionId, "FAMILY_MISMATCH");
    throw new RefreshTokenError({
      code: "FAMILY_MISMATCH",
      userId,
      sessionId,
      familyId,
    });
  }

  if (sha256(tokenId) !== session.refreshTokenHash) {
    await revokeSessionFamily(userId, familyId, "REFRESH_REUSE_DETECTED");
    throw new RefreshTokenError({
      code: "REFRESH_REUSE_DETECTED",
      userId,
      sessionId,
      familyId,
    });
  }

  const newTokenId = randomId(24);

  const ua = getUserAgent(req);
  const ip = getClientIp(req);
  const deviceLabel = buildDeviceLabel(ua);

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      refreshTokenHash: sha256(newTokenId),
      lastSeenAt: new Date(),
      ipLast: ip,
      lastSeenIp: ip,
      userAgentHash: hashUserAgent(ua),
      userAgentRaw: ua || null,
      deviceLabel,
    },
  });

  const currentRole: UserRole = session.user.role ?? role;

  const accessTokenNew = signAccessToken({
    userId,
    role: currentRole,
    sessionId,
  });

  const refreshTokenNew = signRefreshToken({
    userId,
    role: currentRole,
    sessionId,
    familyId,
    tokenId: newTokenId,
  });

  return {
    accessToken: accessTokenNew,
    refreshToken: refreshTokenNew,
    sessionId,
    userId,
    role: currentRole,
    familyId,
  };
}

export async function revokeSession(
  sessionId: string,
  revokedReason?: string,
): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: {
      revokedAt: new Date(),
      revokedReason: revokedReason ?? null,
      isCurrent: false,
    },
  });
}

export async function revokeSessionFamily(
  userId: string,
  familyId: string,
  revokedReason?: string,
): Promise<void> {
  await prisma.session.updateMany({
    where: {
      userId,
      refreshFamilyId: familyId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: revokedReason ?? null,
      isCurrent: false,
    },
  });
}

export async function revokeAllUserSessions(
  userId: string,
  revokedReason?: string,
): Promise<void> {
  await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: revokedReason ?? null,
      isCurrent: false,
    },
  });
}

export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string,
  revokedReason?: string,
): Promise<void> {
  await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      NOT: { id: currentSessionId },
    },
    data: {
      revokedAt: new Date(),
      revokedReason: revokedReason ?? null,
      isCurrent: false,
    },
  });
}

export async function listUserSessions(userId: string) {
  return prisma.session.findMany({
    where: {
      userId,
      revokedAt: null,
    },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      lastSeenAt: true,
      ipFirst: true,
      ipLast: true,
      lastSeenIp: true,
      deviceLabel: true,
      userAgentRaw: true,
      refreshFamilyId: true,
      isCurrent: true,
      revokedAt: true,
      revokedReason: true,
    },
  });
}

export async function revokeUserSession(
  userId: string,
  sessionId: string,
  revokedReason?: string,
): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: revokedReason ?? null,
      isCurrent: false,
    },
  });

  return result.count > 0;
}

export async function listSessionsByUserId(userId: string) {
  return prisma.session.findMany({
    where: {
      userId,
    },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      lastSeenAt: true,
      ipFirst: true,
      ipLast: true,
      lastSeenIp: true,
      deviceLabel: true,
      userAgentRaw: true,
      refreshFamilyId: true,
      isCurrent: true,
      revokedAt: true,
      revokedReason: true,
      roleSnapshot: true,
    },
  });
}

export async function adminRevokeSession(
  sessionId: string,
  revokedReason?: string,
): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: revokedReason ?? "SESSION_REVOKED_BY_ADMIN",
      isCurrent: false,
    },
  });

  return result.count > 0;
}
