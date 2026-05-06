import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { sendError } from "../utils/apiResponse.js";

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function getOriginConfig() {
  const allowedOrigins = env.CORS_ORIGIN.split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);

  const allowAllOrigins = allowedOrigins.includes("*");

  return {
    allowedOrigins,
    allowAllOrigins,
  };
}

export function requireValidOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.method === "OPTIONS") {
    return next();
  }

  const origin = req.headers.origin;

  if (!origin) {
    return next();
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const { allowedOrigins, allowAllOrigins } = getOriginConfig();

  if (allowAllOrigins) {
    return next();
  }

  if (allowedOrigins.length === 0) {
    return next();
  }

  if (allowedOrigins.includes(normalizedOrigin)) {
    return next();
  }

  req.log?.warn(
    {
      origin,
      normalizedOrigin,
      allowedOrigins,
    },
    "origin policy blocked request",
  );

  return sendError(res, {
    statusCode: 403,
    code: "ORIGIN_FORBIDDEN",
    message: "Blocked by Origin policy",
  });
}
