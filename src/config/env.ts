import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  APP_NAME: z.string().default("bus-tracking-backend"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5000),

  API_VERSION: z.string().default("v1"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),

  ACCESS_TOKEN_EXPIRES_IN: z.string().min(1).default("15m"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().min(1).default("7d"),

  COOKIE_SECURE: z.coerce.boolean().default(false),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_DOMAIN: z.string().optional().default(""),

  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  DEFAULT_SPEED_KMH: z.coerce.number().positive().default(20),
  ARRIVAL_RADIUS_METERS: z.coerce.number().positive().default(80),

  LOCATION_DB_WRITE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10000),

  LOCATION_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  LOCATION_MAX_ACCEPTABLE_ACCURACY_M: z.coerce.number().positive().default(120),
  LOCATION_HARD_REJECT_ACCURACY_M: z.coerce.number().positive().default(250),

  LOCATION_STATIONARY_SPEED_THRESHOLD_KMH: z.coerce
    .number()
    .positive()
    .default(3),

  LOCATION_MIN_MOVEMENT_DISTANCE_M: z.coerce.number().positive().default(4),
  LOCATION_SIGNIFICANT_MOVEMENT_DISTANCE_M: z.coerce
    .number()
    .positive()
    .default(12),

  LOCATION_FREEZE_ACCURACY_THRESHOLD_M: z.coerce
    .number()
    .positive()
    .default(35),

  LOCATION_RELEASE_MOVEMENT_DISTANCE_M: z.coerce
    .number()
    .positive()
    .default(18),

  LOCATION_CONFIRM_MOVEMENT_DISTANCE_M: z.coerce
    .number()
    .positive()
    .default(28),

  LOCATION_RAW_SPEED_ASSIST_MIN_KMH: z.coerce.number().positive().default(9),

  LOCATION_MIN_ELAPSED_FOR_MOVEMENT_SECONDS: z.coerce
    .number()
    .positive()
    .default(2.5),

  LOCATION_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15000),

  LOCATION_MAX_SERVER_SPEED_KMH: z.coerce.number().positive().default(120),

  LOCATION_ROLLING_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(180000),

  LOCATION_ACCELERATION_KMH_PER_SEC: z.coerce.number().positive().default(8),
  LOCATION_DECELERATION_KMH_PER_SEC: z.coerce.number().positive().default(12),
  LOCATION_STRONG_BRAKE_KMH_PER_SEC: z.coerce.number().positive().default(20),

  GPS_DEVICE_MAX_ACCEPTABLE_ACCURACY_M: z.coerce
    .number()
    .positive()
    .default(150),
  GPS_DEVICE_HARD_REJECT_ACCURACY_M: z.coerce.number().positive().default(300),
  GPS_DEVICE_STALE_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(90),
  GPS_DEVICE_DISCONNECT_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(180),

  GPS_INGEST_MAX_SPEED_KMH: z.coerce.number().positive().default(300),

  DRIVER_SOURCE_STALE_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(35),
  DRIVER_SOURCE_DISCONNECT_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(90),

  TRACKING_SOURCE_HYSTERESIS_SCORE_GAP: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(25),
  TRACKING_SOURCE_STICKY_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(45),
  TRACKING_LAST_GOOD_HOLD_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(120),
  TRIP_LAST_GOOD_STATE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),

  // Telematics auto-start is the only path to a hands-free, driverless
  // (GPS-only) trip — auto-end already defaults to true, mirroring that here
  // makes the GPS-device flow work out of the box.
  TELEMATICS_AUTO_START_ENABLED: z.coerce.boolean().default(true),

  // Pull positions from Traccar at this interval and feed them through the
  // GPS ingest pipeline. Enabled by default — without this the hardware
  // would only reach us if the operator manually configured a Traccar
  // forwarder, which is fragile and a common source of "device shows
  // online in Traccar but Never seen in our system" bugs.
  TRACCAR_POLL_ENABLED: z.coerce.boolean().default(true),
  TRACCAR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(8000),

  // Realtime push from Traccar via its WebSocket endpoint. This gives us
  // sub-second position updates instead of waiting for the next poll cycle,
  // which is the right experience for a GPS-tracked bus. Keep the poll job
  // enabled too — it's a safety net for missed packets and for the warmup
  // window before the WebSocket auth completes.
  TRACCAR_REALTIME_ENABLED: z.coerce.boolean().default(true),
  TELEMATICS_AUTO_START_REQUIRE_HEALTHY_SOURCE: z.coerce
    .boolean()
    .default(true),
  TELEMATICS_AUTO_START_SCHEDULE_WINDOW_BEFORE_MINUTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(30),
  TELEMATICS_AUTO_START_SCHEDULE_WINDOW_AFTER_MINUTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(45),
  TELEMATICS_AUTO_START_ORIGIN_PROXIMITY_METERS: z.coerce
    .number()
    .positive()
    .default(400),
  TELEMATICS_AUTO_START_MIN_SPEED_KMH: z.coerce.number().positive().default(8),
  TELEMATICS_AUTO_START_MIN_MOVEMENT_DISTANCE_M: z.coerce
    .number()
    .positive()
    .default(60),
  TELEMATICS_AUTO_START_MIN_ELAPSED_SECONDS: z.coerce
    .number()
    .positive()
    .default(20),

  TELEMATICS_AUTO_END_ENABLED: z.coerce.boolean().default(true),
  TELEMATICS_AUTO_END_REQUIRE_HEALTHY_SOURCE: z.coerce.boolean().default(false),
  TELEMATICS_AUTO_END_FINAL_STOP_PROXIMITY_METERS: z.coerce
    .number()
    .positive()
    .default(120),
  TELEMATICS_AUTO_END_STATIONARY_SPEED_KMH: z.coerce
    .number()
    .nonnegative()
    .default(4),
  TELEMATICS_AUTO_END_FINAL_STOP_STATIONARY_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(120),
  TELEMATICS_AUTO_END_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),

  RL_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(600000),
  RL_LOGIN_MAX: z.coerce.number().int().positive().default(20),

  RL_REFRESH_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  RL_REFRESH_MAX: z.coerce.number().int().positive().default(120),

  STOPS_CACHE_TTL_MS: z.coerce.number().int().positive().default(300000),
  STOPS_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(200),

  TRIP_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(180),
  STOPS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  TRIP_LOCK_TTL_MS: z.coerce.number().int().positive().default(10000),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  ENABLE_TRIP_STALE_JOB: z.coerce.boolean().default(true),
  TRIP_STALE_JOB_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  TRIP_STALE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(60),

  GOOGLE_MAPS_SERVER_API_KEY: z.string().optional().default(""),
  GOOGLE_ROUTES_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .default("false")
    .transform((value) => value.trim().toLowerCase() === "true"),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default(""),

  PASSENGER_REGISTRATION_OTP_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10),
  PASSENGER_REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  PASSENGER_REGISTRATION_OTP_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .positive()
    .default(5),

  FORGOT_PASSWORD_ENABLED: z.coerce.boolean().default(true),
  PASSWORD_RESET_OTP_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10),
  PASSWORD_RESET_OTP_RESEND_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  PASSWORD_RESET_OTP_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  RL_FORGOT_PASSWORD_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(600000),
  RL_FORGOT_PASSWORD_MAX: z.coerce.number().int().positive().default(10),

  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
