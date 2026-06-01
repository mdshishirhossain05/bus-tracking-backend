import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { sendError } from "../utils/apiResponse.js";
import { buildCorsConfig, normalizeOrigin } from "../utils/cors.js";

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
  const { allowedOrigins, allowAllOrigins, matchesAllowed } = buildCorsConfig(
    env.CORS_ORIGIN,
  );

  if (allowAllOrigins) {
    return next();
  }

  if (allowedOrigins.length === 0) {
    return next();
  }

  if (matchesAllowed(normalizedOrigin)) {
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
