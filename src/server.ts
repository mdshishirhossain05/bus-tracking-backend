import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { redis, connectRedis } from "./config/redis.js";
import { setIO } from "./sockets/io.js";
import { authenticateSocket } from "./sockets/socketAuth.js";
import { SOCKET_EVENTS, getTripRoom, getUserRoom } from "./sockets/events.js";
import {
  startTripStaleJob,
  stopTripStaleJob,
} from "./services/tripStale.job.js";
import {
  startTraccarPollJob,
  stopTraccarPollJob,
} from "./services/traccarPoll.job.js";
import { processDriverLocationUpdate } from "./services/driverLocation.service.js";
import { locationUpdateSchema } from "./validators/trip.validators.js";
import { uuidParamSchema } from "./validators/params.validators.js";
import { AppError } from "./utils/appError.js";

let isShuttingDown = false;
let httpServer: http.Server | null = null;
let ioServer: SocketIOServer | null = null;
let redisSubClient: ReturnType<typeof redis.duplicate> | null = null;
let socketAdapterReady = false;

const serverLogger = logger.child({ scope: "server" });

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function getCorsConfig() {
  const allowedOrigins = env.CORS_ORIGIN.split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);

  const allowAllOrigins = allowedOrigins.includes("*");

  return {
    allowedOrigins,
    allowAllOrigins,
  };
}

async function initializeSocketRedisAdapter() {
  if (socketAdapterReady) return;

  await connectRedis();

  const pubClient = redis;
  const subClient = pubClient.duplicate();
  redisSubClient = subClient;

  await subClient.connect();

  if (!ioServer) {
    throw new Error("Socket.IO server is not initialized");
  }

  ioServer.adapter(createAdapter(pubClient, subClient));
  socketAdapterReady = true;

  serverLogger.info("socket redis adapter initialized");
}

function startBackgroundServices() {
  setTimeout(() => {
    try {
      startTripStaleJob();
      serverLogger.info("trip stale job startup requested");
    } catch (err) {
      serverLogger.error({ err }, "trip stale job failed to start");
    }
  }, 0);

  setTimeout(() => {
    try {
      startTraccarPollJob();
      serverLogger.info("traccar poll job startup requested");
    } catch (err) {
      serverLogger.error({ err }, "traccar poll job failed to start");
    }
  }, 0);

  setTimeout(() => {
    void initializeSocketRedisAdapter().catch((err) => {
      serverLogger.error(
        { err },
        "redis/socket adapter initialization failed; HTTP server remains alive",
      );
    });
  }, 0);
}

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  serverLogger.warn({ signal }, "starting graceful shutdown");

  const forceExitTimer = setTimeout(() => {
    serverLogger.error("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 10000);

  try {
    try {
      stopTripStaleJob();
    } catch (err) {
      serverLogger.error({ err }, "failed stopping trip stale job");
    }

    try {
      stopTraccarPollJob();
    } catch (err) {
      serverLogger.error({ err }, "failed stopping traccar poll job");
    }

    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      serverLogger.info("http server closed");
    }

    if (ioServer) {
      ioServer.close();
      serverLogger.info("socket.io server closed");
    }

    if (redisSubClient?.isOpen) {
      await redisSubClient.quit();
      serverLogger.info("redis subscriber disconnected");
    }

    if (redis.isOpen) {
      await redis.quit();
      serverLogger.info("redis client disconnected");
    }

    await prisma.$disconnect();
    serverLogger.info("prisma disconnected");

    clearTimeout(forceExitTimer);
    serverLogger.info("graceful shutdown completed");
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExitTimer);
    serverLogger.error({ err }, "error during graceful shutdown");
    process.exit(1);
  }
}

async function bootstrap() {
  const app = createApp();
  const { allowedOrigins, allowAllOrigins } = getCorsConfig();

  const server = http.createServer(app);
  httpServer = server;

  server.on("error", (err) => {
    serverLogger.fatal({ err }, "http server error");
    void shutdown("httpServerError");
  });

  const io = new SocketIOServer(server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);

        const normalizedOrigin = normalizeOrigin(origin);

        if (allowAllOrigins) return cb(null, true);
        if (allowedOrigins.length === 0) return cb(null, true);
        if (allowedOrigins.includes(normalizedOrigin)) return cb(null, true);

        return cb(new Error(`Socket CORS blocked origin: ${origin}`));
      },
      credentials: true,
    },
  });

  ioServer = io;
  setIO(io);

  io.on("connection", async (socket) => {
    try {
      authenticateSocket(socket);
    } catch (e: any) {
      const authLogger = logger.child({
        scope: "socket",
        socketId: socket.id,
      });

      authLogger.warn(
        {
          reason: e?.message,
        },
        "socket authentication failed",
      );

      socket.emit(SOCKET_EVENTS.AUTH_ERROR, {
        message: "unauthorized",
        reason: e?.message,
      });
      socket.disconnect(true);
      return;
    }

    const socketLogger = logger.child({
      scope: "socket",
      socketId: socket.id,
      userId: socket.data.auth?.userId,
      role: socket.data.auth?.role,
    });

    socketLogger.info("socket connected");

    socket.emit(SOCKET_EVENTS.CONNECTED, {
      message: "Socket connected",
      socketAdapterReady,
    });

    // Join a per-user room so user-targeted events (e.g. notifications)
    // can be delivered without knowing the socket id.
    const authUserId = socket.data.auth?.userId;
    if (authUserId) {
      socket.join(getUserRoom(authUserId));
    }

    socket.on(SOCKET_EVENTS.JOIN_TRIP, async ({ tripId }) => {
      const auth = socket.data.auth;
      if (!auth) return;

      const deny = (reason: string) => {
        socketLogger.warn({ tripId, reason }, "join_trip denied");
        socket.emit(SOCKET_EVENTS.JOIN_DENIED, { tripId, reason });
      };

      try {
        if (typeof tripId !== "string" || tripId.length === 0) {
          return deny("INVALID_TRIP_ID");
        }

        const session = await prisma.session.findUnique({
          where: { id: auth.sessionId },
          select: { revokedAt: true, userId: true },
        });

        if (!session) return deny("SESSION_NOT_FOUND");
        if (session.revokedAt) return deny("SESSION_REVOKED");
        if (session.userId !== auth.userId) {
          return deny("SESSION_USER_MISMATCH");
        }

        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: {
            id: true,
            status: true,
            driverId: true,
            routeId: true,
            busId: true,
            startTime: true,
            endTime: true,
          },
        });

        if (!trip) return deny("TRIP_NOT_FOUND");

        if (auth.role === "DRIVER") {
          if (trip.driverId !== auth.userId) return deny("NOT_YOUR_TRIP");
          if (trip.status !== "RUNNING") return deny("TRIP_NOT_RUNNING");
        }

        if (auth.role === "PASSENGER") {
          if (trip.status !== "RUNNING") return deny("TRIP_NOT_RUNNING");
        }

        socket.join(getTripRoom(tripId));

        socketLogger.info({ tripId }, "joined trip room");

        socket.emit(SOCKET_EVENTS.JOINED_TRIP, {
          tripId,
          trip: {
            id: trip.id,
            status: trip.status,
            routeId: trip.routeId,
            busId: trip.busId,
            driverId: trip.driverId,
            startedAt: trip.startTime,
            endedAt: trip.endTime,
          },
        });
      } catch (err) {
        socketLogger.error({ err, tripId }, "join_trip failed");
        return deny("JOIN_ERROR");
      }
    });

    socket.on(SOCKET_EVENTS.LEAVE_TRIP, ({ tripId }) => {
      if (typeof tripId === "string" && tripId.length > 0) {
        socket.leave(getTripRoom(tripId));
        socketLogger.info({ tripId }, "left trip room");
        socket.emit(SOCKET_EVENTS.LEFT_TRIP, { tripId });
      }
    });

    // Realtime driver location ingestion. Streams over the persistent socket
    // instead of one HTTP request per fix; the result is returned via the
    // ack callback so the driver client gets the same authoritative payload
    // the HTTP endpoint would have produced.
    socket.on(SOCKET_EVENTS.DRIVER_LOCATION, async (payload, ack) => {
      const respond = typeof ack === "function" ? ack : () => {};
      const auth = socket.data.auth;

      if (!auth) {
        respond({ ok: false, code: "UNAUTHORIZED", message: "Unauthorized" });
        return;
      }

      if (auth.role !== "DRIVER") {
        respond({
          ok: false,
          code: "FORBIDDEN",
          message: "Driver role required",
        });
        return;
      }

      const body = (payload ?? {}) as Record<string, unknown>;

      const tripIdParsed = uuidParamSchema.safeParse(body.tripId);
      if (!tripIdParsed.success) {
        respond({
          ok: false,
          code: "INVALID_TRIP_ID",
          message: "Invalid tripId",
        });
        return;
      }

      const locationParsed = locationUpdateSchema.safeParse(
        body.location ?? body,
      );
      if (!locationParsed.success) {
        respond({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "Invalid location data",
          details: locationParsed.error.format(),
        });
        return;
      }

      try {
        const data = await processDriverLocationUpdate({
          driverId: auth.userId,
          tripId: tripIdParsed.data,
          input: locationParsed.data,
          logger: socketLogger,
        });

        respond({ ok: true, data });
      } catch (err) {
        if (err instanceof AppError) {
          respond({ ok: false, code: err.code, message: err.message });
          return;
        }

        socketLogger.error(
          { err, tripId: tripIdParsed.data },
          "driver:location failed",
        );
        respond({
          ok: false,
          code: "INTERNAL_ERROR",
          message: "Failed to process location update",
        });
      }
    });

    socket.on("disconnect", (reason) => {
      socketLogger.info({ reason }, "socket disconnected");
    });
  });

  const port = Number(env.PORT);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "0.0.0.0", () => {
      serverLogger.info(
        {
          port,
          host: "0.0.0.0",
          nodeEnv: env.NODE_ENV,
        },
        "server started",
      );
      resolve();
    });

    server.once("error", reject);
  });

  startBackgroundServices();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("uncaughtException", (err) => {
  serverLogger.fatal({ err }, "uncaught exception");
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  serverLogger.fatal({ reason }, "unhandled rejection");
  void shutdown("unhandledRejection");
});

bootstrap().catch((err) => {
  serverLogger.fatal({ err }, "fatal startup error");
  process.exit(1);
});
