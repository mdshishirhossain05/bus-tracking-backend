import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
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

function isApiRequest(req: Request) {
  return (
    req.path.startsWith("/api/") ||
    req.originalUrl.startsWith("/api/") ||
    req.path.startsWith(`/api/${env.API_VERSION}`) ||
    req.originalUrl.startsWith(`/api/${env.API_VERSION}`)
  );
}

function setApiNoStoreHeaders(res: Response) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.removeHeader("ETag");
}

function noStoreApiResponses(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isApiRequest(req)) {
    return next();
  }

  /*
   * Admin/API responses are user-specific and mutation-sensitive.
   * Never allow browser/proxy conditional cache responses such as 304.
   */
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];

  setApiNoStoreHeaders(res);
  return next();
}

export function createApp() {
  const app = express();
  const { allowedOrigins, allowAllOrigins } = getCorsConfig();

  app.set("trust proxy", 1);

  /*
   * Permanent API freshness fix:
   * Express generates weak ETags by default. Browsers then send If-None-Match,
   * and mutation-sensitive admin GET endpoints can return 304 Not Modified.
   * That caused deleted stops to reappear from browser cache.
   */
  app.disable("etag");

  app.use(requestContext);
  app.use(noStoreApiResponses);

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