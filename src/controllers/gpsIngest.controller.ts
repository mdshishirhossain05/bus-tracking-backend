import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { AppError } from "../utils/appError.js";
import { ingestGpsDeviceLocationService } from "../services/gpsIngest.service.js";

const gpsIngestSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  speedKmh: z.number().finite().min(0).max(300).nullable().optional(),
  heading: z.number().int().min(0).max(360).nullable().optional(),
  accuracyM: z.number().finite().min(0).max(1000).nullable().optional(),
  recordedAt: z.string().datetime().optional(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
});

export async function ingestGpsDeviceLocation(req: AuthRequest, res: Response) {
  if (!req.device?.id || !req.device?.deviceCode) {
    throw new AppError({
      statusCode: 401,
      code: "DEVICE_AUTH_REQUIRED",
      message: "GPS device authentication required",
    });
  }

  const parsed = gpsIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid GPS ingest payload",
      details: parsed.error.format(),
    });
  }

  const recordedAt = parsed.data.recordedAt
    ? new Date(parsed.data.recordedAt)
    : new Date();

  const data = await ingestGpsDeviceLocationService({
    gpsDeviceId: req.device.id,
    deviceCode: req.device.deviceCode,
    lat: parsed.data.lat,
    lng: parsed.data.lng,
    speedKmh: parsed.data.speedKmh ?? null,
    heading: parsed.data.heading ?? null,
    accuracyM: parsed.data.accuracyM ?? null,
    recordedAt,
    rawPayload: parsed.data.rawPayload ?? null,
    requestIp:
      req.ip ||
      (typeof req.headers["x-forwarded-for"] === "string"
        ? req.headers["x-forwarded-for"]
        : null),
  });

  return sendSuccess(res, {
    message: "GPS device packet accepted",
    data,
  });
}
