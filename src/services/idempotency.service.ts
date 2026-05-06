import { redis } from "../config/redis.js";
import crypto from "node:crypto";
import { env } from "../config/env.js";

const TTL_SECONDS = Number(env.IDEMPOTENCY_TTL_SECONDS ?? 3600);

type StoredResponse = {
  statusCode: number;
  body: unknown;
};

type StoredRecord =
  | {
      state: "IN_PROGRESS";
      fingerprint: string;
      createdAt: string;
    }
  | {
      state: "COMPLETED";
      fingerprint: string;
      createdAt: string;
      response: StoredResponse;
    };

function key(idempotencyKey: string) {
  return `idem:${idempotencyKey}`;
}

export function buildFingerprint(input: unknown): string {
  const json = JSON.stringify(input);
  return crypto.createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * Try to begin an idempotent request.
 *
 * Returns:
 * - STARTED: caller may proceed
 * - REPLAY: completed response exists, return it
 * - CONFLICT: same key used for different request
 * - IN_PROGRESS: same key currently being processed
 */
export async function beginIdempotentRequest(params: {
  idempotencyKey: string;
  fingerprint: string;
}): Promise<
  | { type: "STARTED" }
  | { type: "REPLAY"; response: StoredResponse }
  | { type: "CONFLICT" }
  | { type: "IN_PROGRESS" }
> {
  const { idempotencyKey, fingerprint } = params;
  const redisKey = key(idempotencyKey);

  const existingRaw = await redis.get(redisKey);
  if (!existingRaw) {
    const record: StoredRecord = {
      state: "IN_PROGRESS",
      fingerprint,
      createdAt: new Date().toISOString(),
    };

    const ok = await redis.set(redisKey, JSON.stringify(record), {
      NX: true,
      EX: TTL_SECONDS,
    });

    if (ok === "OK") {
      return { type: "STARTED" };
    }

    // race fallback
    return beginIdempotentRequest(params);
  }

  const existing = JSON.parse(existingRaw) as StoredRecord;

  if (existing.fingerprint !== fingerprint) {
    return { type: "CONFLICT" };
  }

  if (existing.state === "COMPLETED") {
    return { type: "REPLAY", response: existing.response };
  }

  return { type: "IN_PROGRESS" };
}

export async function completeIdempotentRequest(params: {
  idempotencyKey: string;
  fingerprint: string;
  statusCode: number;
  body: unknown;
}): Promise<void> {
  const { idempotencyKey, fingerprint, statusCode, body } = params;

  const record: StoredRecord = {
    state: "COMPLETED",
    fingerprint,
    createdAt: new Date().toISOString(),
    response: {
      statusCode,
      body,
    },
  };

  await redis.set(key(idempotencyKey), JSON.stringify(record), {
    EX: TTL_SECONDS,
  });
}

export async function failIdempotentRequest(
  idempotencyKey: string,
): Promise<void> {
  await redis.del(key(idempotencyKey));
}
