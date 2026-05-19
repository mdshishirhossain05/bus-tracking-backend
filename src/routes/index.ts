import type { Express } from "express";

import { authRouter } from "./auth.routes.js";
import { healthRouter } from "./health.routes.js";

import { adminTestRouter } from "./admin/test.routes.js";
import { adminBusRouter } from "./admin/bus.routes.js";
import { adminStopRouter } from "./admin/stop.routes.js";
import { adminRouteRouter } from "./admin/route.routes.js";
import { adminRouteStopRouter } from "./admin/routeStop.routes.js";
import { adminSessionRouter } from "./admin/session.routes.js";
import { adminUserRouter } from "./admin/user.routes.js";
import { adminScheduleRouter } from "./admin/schedule.routes.js";
import { adminServiceScheduleRouter } from "./admin/serviceSchedule.routes.js";
import { adminOperationsRouter } from "./admin/operations.routes.js";
import { adminAuditLogRouter } from "./admin/auditLog.routes.js";
import { adminAnalyticsRouter } from "./admin/analytics.routes.js";

import { driverTripRouter } from "./driver.trip.routes.js";
import { gpsIngestRouter } from "./gps.ingest.routes.js";

import { passengerTrackingRouter } from "./passenger.tracking.routes.js";
import { passengerTripsRouter } from "./passenger.trips.routes.js";
import { favoriteRouter } from "./favorite.routes.js";
import { notificationRouter } from "./notification.routes.js";
import { routePresentationRouter } from "./route.presentation.routes.js";

export function registerRoutes(app: Express) {
  const apiBase = "/api/v1";

  /**
   * Health check
   * Used by Railway / monitoring systems
   */
  app.use(healthRouter);

  /**
   * Authentication routes
   */
  app.use(apiBase, authRouter);

  /**
   * Admin routes
   */
  app.use(apiBase, adminTestRouter);
  app.use(apiBase, adminBusRouter);
  app.use(apiBase, adminStopRouter);
  app.use(apiBase, adminRouteRouter);
  app.use(apiBase, adminRouteStopRouter);
  app.use(apiBase, adminSessionRouter);
  app.use(apiBase, adminUserRouter);
  app.use(apiBase, adminScheduleRouter);
  app.use(apiBase, adminServiceScheduleRouter);
  app.use(apiBase, adminOperationsRouter);
  app.use(apiBase, adminAuditLogRouter);
  app.use(apiBase, adminAnalyticsRouter);

  /**
   * Driver routes
   */
  app.use(apiBase, driverTripRouter);

  /**
   * GPS device ingest routes
   */
  app.use(apiBase, gpsIngestRouter);

  /**
   * Passenger routes
   */
  app.use(apiBase, passengerTrackingRouter);
  app.use(apiBase, passengerTripsRouter);
  app.use(apiBase, favoriteRouter);
  app.use(apiBase, notificationRouter);

  /**
   * Shared route presentation
   */
  app.use(apiBase, routePresentationRouter);
}
