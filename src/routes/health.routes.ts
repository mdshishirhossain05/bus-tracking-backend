import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { redis } from "../config/redis.js";
import { sendSuccess, sendError } from "../utils/apiResponse.js";

export const healthRouter = Router();

type ServiceState = "connected" | "disconnected" | "unknown";

type DependencyChecks = {
  db: ServiceState;
  redis: ServiceState;
};

async function checkDependencies(req: any): Promise<DependencyChecks> {
  const checks: DependencyChecks = {
    db: "unknown",
    redis: "unknown",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "connected";
  } catch (err) {
    checks.db = "disconnected";
    req.log?.error({ err }, "database health check failed");
  }

  try {
    if (!redis.isOpen) {
      checks.redis = "disconnected";
      req.log?.warn("redis client is not open");
    } else {
      const pong = await redis.ping();
      checks.redis = pong === "PONG" ? "connected" : "disconnected";

      if (checks.redis !== "connected") {
        req.log?.warn({ pong }, "redis ping did not return PONG");
      }
    }
  } catch (err) {
    checks.redis = "disconnected";
    req.log?.error({ err }, "redis health check failed");
  }

  return checks;
}

/**
 * @openapi
 * /live:
 *   get:
 *     summary: Liveness probe
 *     description: Returns whether the process is alive.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is alive
 */
healthRouter.get("/live", (_req, res) => {
  return sendSuccess(res, {
    message: "Service is alive",
    data: {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * @openapi
 * /ready:
 *   get:
 *     summary: Readiness probe
 *     description: Returns whether the service is ready to receive traffic.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is not ready
 */
healthRouter.get("/ready", async (req, res) => {
  const checks = await checkDependencies(req);
  const isReady = checks.db === "connected" && checks.redis === "connected";

  if (!isReady) {
    return res.status(503).json({
      success: false,
      code: "SERVICE_NOT_READY",
      message: "Service is not ready",
      data: {
        status: "not_ready",
        checks,
        timestamp: new Date().toISOString(),
      },
    });
  }

  return sendSuccess(res, {
    message: "Service is ready",
    data: {
      status: "ok",
      checks,
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns dependency health for database and Redis.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 *       503:
 *         description: Service is unhealthy
 */
healthRouter.get("/health", async (req, res) => {
  const checks = await checkDependencies(req);
  const healthy = checks.db === "connected" && checks.redis === "connected";

  if (!healthy) {
    return res.status(503).json({
      success: false,
      code: "SERVICE_UNHEALTHY",
      message: "Service is unhealthy",
      data: {
        status: "unhealthy",
        checks,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  }

  return sendSuccess(res, {
    message: "Service is healthy",
    data: {
      status: "ok",
      checks,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});
