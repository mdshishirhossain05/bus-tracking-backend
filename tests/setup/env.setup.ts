// Vitest global setup: ensure the process runs in test mode before any
// application module (which validates env on import) is loaded.
process.env.NODE_ENV = "test";
process.env.ENABLE_TRIP_STALE_JOB = process.env.ENABLE_TRIP_STALE_JOB ?? "false";
