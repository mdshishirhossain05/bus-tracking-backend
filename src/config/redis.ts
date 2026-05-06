import { createClient } from "redis";
import { env } from "./env.js";
import { logger } from "./logger.js";

const redisLogger = logger.child({ scope: "redis" });

export const redis = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy(retries) {
      if (retries > 10) {
        return new Error("Redis reconnect failed after 10 attempts");
      }
      return Math.min(retries * 100, 3000);
    },
  },
});

redis.on("error", (err) => {
  redisLogger.error(
    { err: err instanceof Error ? err.message : err },
    "redis error",
  );
});

export async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
    redisLogger.info("redis connected");
  }
}
