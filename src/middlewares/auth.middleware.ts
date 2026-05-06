import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { sendError } from "../utils/apiResponse.js";
import { prisma } from "../config/prisma.js";

export type AuthRequest = Request & {
  user?: {
    id: string;
    role: string;
    sessionId?: string;
  };
  device?: {
    id: string;
    deviceCode: string;
  };
  cookies?: Record<string, any>;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

function safeHashEquals(rawSecret: string, storedHashHex: string) {
  const candidate = sha256(rawSecret);
  const stored = Buffer.from(storedHashHex, "hex");

  if (candidate.length !== stored.length) {
    return false;
  }

  return timingSafeEqual(candidate, stored);
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const cookieToken = req.cookies?.access_token;

  const header = req.headers.authorization;
  const bearer =
    header && header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  const token = cookieToken || bearer;

  if (!token) {
    return sendError(res, {
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  try {
    const payload = verifyAccessToken(token);

    if (payload?.type !== "access") {
      return sendError(res, {
        statusCode: 401,
        code: "INVALID_TOKEN_TYPE",
        message: "Invalid token type",
      });
    }

    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: {
        user: {
          select: {
            id: true,
            isActive: true,
          },
        },
      },
    });

    if (!session) {
      req.log?.warn(
        { sessionId: payload.sessionId, userId: payload.userId },
        "session not found during auth check",
      );

      return sendError(res, {
        statusCode: 401,
        code: "SESSION_NOT_FOUND",
        message: "Session not found",
      });
    }

    if (session.revokedAt) {
      req.log?.warn(
        { sessionId: session.id, userId: session.userId },
        "revoked session attempted access",
      );

      return sendError(res, {
        statusCode: 401,
        code: "SESSION_REVOKED",
        message: "Session revoked",
      });
    }

    if (session.userId !== payload.userId) {
      req.log?.warn(
        {
          sessionId: session.id,
          tokenUserId: payload.userId,
          sessionUserId: session.userId,
        },
        "session user mismatch during auth check",
      );

      return sendError(res, {
        statusCode: 401,
        code: "SESSION_USER_MISMATCH",
        message: "Session user mismatch",
      });
    }

    if (!session.user.isActive) {
      req.log?.warn(
        { sessionId: session.id, userId: session.userId },
        "inactive user attempted access",
      );

      return sendError(res, {
        statusCode: 401,
        code: "USER_INACTIVE",
        message: "User inactive",
      });
    }

    req.user = {
      id: payload.userId,
      role: payload.role,
      sessionId: payload.sessionId,
    };

    return next();
  } catch (err: any) {
    req.log?.warn(
      {
        reason: err?.name,
        detail: err?.message,
      },
      "access token verification failed",
    );

    return sendError(res, {
      statusCode: 401,
      code: "INVALID_OR_EXPIRED_TOKEN",
      message: "Invalid or expired token",
      details: {
        reason: err?.name,
        detail: err?.message,
      },
    });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendError(res, {
        statusCode: 401,
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    if (!roles.includes(req.user.role)) {
      req.log?.warn(
        {
          userId: req.user.id,
          userRole: req.user.role,
          allowedRoles: roles,
        },
        "role access denied",
      );

      return sendError(res, {
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Forbidden",
      });
    }

    return next();
  };
}

export async function requireGpsDeviceAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const pathDeviceCode =
    typeof req.params.deviceCode === "string"
      ? req.params.deviceCode.trim()
      : "";

  const headerDeviceCode =
    typeof req.headers["x-device-code"] === "string"
      ? req.headers["x-device-code"].trim()
      : "";

  const apiKey =
    typeof req.headers["x-device-api-key"] === "string"
      ? req.headers["x-device-api-key"].trim()
      : "";

  const deviceCode = pathDeviceCode || headerDeviceCode;

  if (!deviceCode || !apiKey) {
    return sendError(res, {
      statusCode: 401,
      code: "DEVICE_AUTH_REQUIRED",
      message: "x-device-code and x-device-api-key are required",
    });
  }

  const gpsDevice = await prisma.gpsDevice.findUnique({
    where: { deviceCode },
    select: {
      id: true,
      deviceCode: true,
      apiKeyHash: true,
      isActive: true,
    },
  });

  if (!gpsDevice) {
    req.log?.warn({ deviceCode }, "gps device not found during auth");
    return sendError(res, {
      statusCode: 401,
      code: "DEVICE_NOT_FOUND",
      message: "GPS device not found",
    });
  }

  if (!gpsDevice.isActive) {
    req.log?.warn(
      { deviceCode, deviceId: gpsDevice.id },
      "inactive gps device attempted ingest",
    );
    return sendError(res, {
      statusCode: 401,
      code: "DEVICE_INACTIVE",
      message: "GPS device inactive",
    });
  }

  const matches = safeHashEquals(apiKey, gpsDevice.apiKeyHash);
  if (!matches) {
    req.log?.warn(
      { deviceCode, deviceId: gpsDevice.id },
      "gps device api key mismatch",
    );
    return sendError(res, {
      statusCode: 401,
      code: "DEVICE_AUTH_FAILED",
      message: "Invalid GPS device credentials",
    });
  }

  req.device = {
    id: gpsDevice.id,
    deviceCode: gpsDevice.deviceCode,
  };

  return next();
}
