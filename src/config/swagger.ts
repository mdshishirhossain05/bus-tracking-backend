import swaggerJsdoc from "swagger-jsdoc";
import { env } from "./env.js";

const fallbackServerUrl =
  env.NODE_ENV === "production"
    ? `/api/${env.API_VERSION}`
    : `http://localhost:${env.PORT}/api/${env.API_VERSION}`;

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Bus Tracking API",
      version: "1.0.0",
      description: "Real-time Bus Tracking System API documentation",
    },
    servers: [
      {
        url: fallbackServerUrl,
        description:
          env.NODE_ENV === "production"
            ? "Production server"
            : "Local development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "access_token",
        },
      },
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            fullName: { type: "string" },
            email: { type: "string", format: "email" },
            role: {
              type: "string",
              enum: ["ADMIN", "DRIVER", "PASSENGER"],
            },
            isActive: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
          },
        },

        Session: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            deviceLabel: { type: "string", nullable: true },
            userAgentRaw: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            lastSeenAt: { type: "string", format: "date-time" },
            ipFirst: { type: "string", nullable: true },
            ipLast: { type: "string", nullable: true },
            lastSeenIp: { type: "string", nullable: true },
            refreshFamilyId: { type: "string" },
            current: { type: "boolean" },
            revokedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            revokedReason: { type: "string", nullable: true },
          },
        },

        Trip: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            busId: { type: "string", format: "uuid" },
            routeId: { type: "string", format: "uuid" },
            driverId: { type: "string", format: "uuid" },
            status: {
              type: "string",
              enum: ["PLANNED", "RUNNING", "ENDED"],
            },
            startTime: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            endTime: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },

        LocationUpdateRequest: {
          type: "object",
          required: ["lat", "lng"],
          properties: {
            lat: {
              type: "number",
              example: 23.780573,
            },
            lng: {
              type: "number",
              example: 90.279239,
            },
            speedKmh: {
              type: "number",
              example: 32,
            },
            heading: {
              type: "integer",
              example: 180,
            },
            accuracyM: {
              type: "number",
              example: 10,
            },
            recordedAt: {
              type: "string",
              format: "date-time",
              example: "2026-03-09T12:00:00Z",
            },
          },
        },

        EtaResponse: {
          type: "object",
          properties: {
            nearestStop: {
              type: "object",
              properties: {
                stopId: { type: "string", format: "uuid" },
                stopName: { type: "string" },
                stopOrder: { type: "integer" },
                distanceMeters: { type: "integer" },
              },
            },
            nextStop: {
              type: "object",
              properties: {
                stopId: { type: "string", format: "uuid" },
                stopName: { type: "string" },
                stopOrder: { type: "integer" },
                distanceMeters: { type: "integer" },
              },
            },
            etaMinutes: {
              type: "integer",
              nullable: true,
            },
            usedSpeedKmh: { type: "number" },
            confidence: {
              type: "string",
              enum: ["HIGH", "MEDIUM", "LOW"],
            },
          },
        },

        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
            data: { type: "object", nullable: true },
          },
        },

        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            code: { type: "string", example: "VALIDATION_ERROR" },
            message: { type: "string", example: "Invalid data" },
            details: { type: "object", nullable: true },
          },
        },
      },
    },
  },
  apis: ["./src/routes/**/*.ts"],
});
