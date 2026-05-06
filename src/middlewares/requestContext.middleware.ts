import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { logger } from "../config/logger.js";

function getRequestId(req: Request): string {
  const incoming = req.header("X-Request-Id");
  if (incoming && incoming.trim().length > 0) return incoming.trim();
  return crypto.randomUUID();
}

export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const requestId = getRequestId(req);

  req.requestId = requestId;
  req.log = logger.child({
    requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });

  res.setHeader("X-Request-Id", requestId);

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    const payload = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      contentLength: res.getHeader("content-length") ?? null,
    };

    if (res.statusCode >= 500) {
      req.log?.error(payload, "request completed with server error");
      return;
    }

    if (res.statusCode >= 400) {
      req.log?.warn(payload, "request completed with client error");
      return;
    }

    req.log?.info(payload, "request completed");
  });

  next();
}
