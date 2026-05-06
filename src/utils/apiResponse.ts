import type { Response } from "express";

export function sendSuccess<T>(
  res: Response,
  params: {
    statusCode?: number;
    message: string;
    data?: T;
  },
) {
  const { statusCode = 200, message, data } = params;

  return res.status(statusCode).json({
    success: true,
    message,
    ...(data !== undefined ? { data } : {}),
  });
}

export function sendError(
  res: Response,
  params: {
    statusCode: number;
    message: string;
    code: string;
    details?: unknown;
    stack?: string;
  },
) {
  const isProd = process.env.NODE_ENV === "production";

  return res.status(params.statusCode).json({
    success: false,
    message: params.message,
    code: params.code,
    ...(!isProd && params.details !== undefined
      ? { details: params.details }
      : {}),
    ...(!isProd && params.stack ? { stack: params.stack } : {}),
  });
}
