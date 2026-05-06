import { Router } from "express";
import { requireGpsDeviceAuth } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ingestGpsDeviceLocation } from "../controllers/gpsIngest.controller.js";

export const gpsIngestRouter = Router();

/**
 * @openapi
 * /gps/devices/{deviceCode}/ingest:
 *   post:
 *     summary: Ingest fixed GPS location packet
 *     description: Secure ingest endpoint for assigned fixed GPS devices. This writes GPS source state and device telemetry, but does not yet arbitrate canonical passenger/admin live state.
 *     tags:
 *       - GPS Device Ingest
 *     parameters:
 *       - in: path
 *         name: deviceCode
 *         required: true
 *         schema:
 *           type: string
 *         description: GPS device code
 *       - in: header
 *         name: x-device-code
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional duplicate device code header. Path deviceCode is primary.
 *       - in: header
 *         name: x-device-api-key
 *         required: true
 *         schema:
 *           type: string
 *         description: Device API key
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lat
 *               - lng
 *             properties:
 *               lat:
 *                 type: number
 *                 example: 23.780573
 *               lng:
 *                 type: number
 *                 example: 90.279239
 *               speedKmh:
 *                 type: number
 *                 nullable: true
 *                 example: 34
 *               heading:
 *                 type: integer
 *                 nullable: true
 *                 example: 180
 *               accuracyM:
 *                 type: number
 *                 nullable: true
 *                 example: 12
 *               recordedAt:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 example: "2026-04-08T08:00:00Z"
 *               rawPayload:
 *                 type: object
 *                 nullable: true
 *                 additionalProperties: true
 *     responses:
 *       200:
 *         description: GPS packet accepted
 *       400:
 *         description: Invalid GPS payload
 *       401:
 *         description: Invalid GPS device credentials
 *       404:
 *         description: Active bus assignment not found
 */
gpsIngestRouter.post(
  "/gps/devices/:deviceCode/ingest",
  requireGpsDeviceAuth,
  asyncHandler(ingestGpsDeviceLocation),
);
