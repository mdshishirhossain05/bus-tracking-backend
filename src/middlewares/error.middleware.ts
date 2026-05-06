import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { AppError } from "../utils/appError.js";
import { sendError } from "../utils/apiResponse.js";

function mapPrismaError(err: unknown): AppError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return new AppError({
        statusCode: 409,
        code: "UNIQUE_CONSTRAINT_VIOLATION",
        message: "Duplicate value violates a unique constraint",
        details: err.meta,
      });
    }

    if (err.code === "P2025") {
      return new AppError({
        statusCode: 404,
        code: "RECORD_NOT_FOUND",
        message: "Requested record was not found",
        details: err.meta,
      });
    }
  }

  return null;
}

export function notFoundHandler(req: Request, res: Response) {
  req.log?.warn(
    {
      method: req.method,
      path: req.originalUrl,
      requestId: req.requestId ?? null,
    },
    "route not found",
  );

  return sendError(res, {
    statusCode: 404,
    code: "ROUTE_NOT_FOUND",
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const isProd = env.NODE_ENV === "production";

  if (err instanceof AppError) {
    req.log?.warn(
      {
        requestId: req.requestId ?? null,
        code: err.code,
        statusCode: err.statusCode,
        details: err.details,
        errorName: err.name,
        errorMessage: err.message,
        errorStack: err.stack,
      },
      "handled app error",
    );

    return sendError(res, {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
      ...(isProd ? {} : { stack: err.stack }),
    });
  }

  if (err instanceof ZodError) {
    req.log?.warn(
      {
        requestId: req.requestId ?? null,
        issues: err.flatten(),
        errorName: err.name,
        errorMessage: err.message,
        errorStack: err.stack,
      },
      "validation error",
    );

    return sendError(res, {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: err.flatten(),
      ...(isProd ? {} : { stack: err.stack }),
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    req.log?.error(
      {
        requestId: req.requestId ?? null,
        prismaCode: err.code,
        prismaMeta: err.meta,
        errorName: err.name,
        errorMessage: err.message,
        errorStack: err.stack,
      },
      "prisma known request error",
    );

    const prismaMapped = mapPrismaError(err);
    if (prismaMapped) {
      return sendError(res, {
        statusCode: prismaMapped.statusCode,
        code: prismaMapped.code,
        message: prismaMapped.message,
        details: prismaMapped.details,
        ...(isProd ? {} : { stack: prismaMapped.stack }),
      });
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    req.log?.error(
      {
        requestId: req.requestId ?? null,
        errorName: err.name,
        errorMessage: err.message,
        errorStack: err.stack,
      },
      "prisma validation error",
    );
  }

  if (err instanceof Error) {
    req.log?.error(
      {
        requestId: req.requestId ?? null,
        errorName: err.name,
        errorMessage: err.message,
        errorStack: err.stack,
      },
      "unhandled server error",
    );

    return sendError(res, {
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: isProd ? "Internal server error" : err.message,
      ...(isProd ? {} : { details: err, stack: err.stack }),
    });
  }

  req.log?.error(
    {
      requestId: req.requestId ?? null,
      unknownError: err,
    },
    "unhandled non-error server failure",
  );

  return sendError(res, {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
  });
}
