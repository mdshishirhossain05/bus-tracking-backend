import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import swaggerUi from "swagger-ui-express";

import { env } from "./config/env.js";
import { swaggerSpec } from "./config/swagger.js";
import { requireValidOrigin } from "./middlewares/origin.middleware.js";
import { requestContext } from "./middlewares/requestContext.middleware.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middlewares/error.middleware.js";
import { registerRoutes } from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export function createApp() {
  const app = express();
  const { allowedOrigins, allowAllOrigins } = getCorsConfig();

  app.set("trust proxy", 1);

  app.use(requestContext);

  const corsMiddleware = cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);

      const normalizedOrigin = normalizeOrigin(origin);

      if (allowAllOrigins) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true);
      if (allowedOrigins.includes(normalizedOrigin)) return cb(null, true);

      console.warn("CORS blocked origin:", {
        origin,
        normalizedOrigin,
        allowedOrigins,
      });

      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Idempotency-Key",
      "idempotency-key",
    ],
    optionsSuccessStatus: 204,
  });

  app.use(corsMiddleware);
  app.options(/.*/, corsMiddleware);

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(requireValidOrigin);

  app.use(express.static(path.join(__dirname, "./public")));

  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
    }),
  );

  app.get("/docs-json", (_req, res) => {
    res.json(swaggerSpec);
  });

  registerRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}