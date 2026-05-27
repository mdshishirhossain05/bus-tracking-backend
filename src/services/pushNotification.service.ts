import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(token.trim());
}

export async function registerPushTokenService(params: {
  userId: string;
  token: string;
  platform?: string | null;
  deviceName?: string | null;
}): Promise<{ ok: boolean }> {
  const token = params.token.trim();
  if (!isExpoToken(token)) return { ok: false };

  // A device's Expo token is globally unique; on a re-login reassign it to
  // whoever is signed in now so alerts follow the active account.
  await prisma.pushToken.upsert({
    where: { token },
    update: {
      userId: params.userId,
      platform: params.platform ?? null,
      deviceName: params.deviceName ?? null,
      lastSeenAt: new Date(),
    },
    create: {
      userId: params.userId,
      token,
      platform: params.platform ?? null,
      deviceName: params.deviceName ?? null,
    },
  });

  return { ok: true };
}

export async function removePushTokenService(
  userId: string,
  token: string,
): Promise<void> {
  await prisma.pushToken.deleteMany({
    where: { userId, token: token.trim() },
  });
}

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  channelId: string;
  priority: "high";
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Best-effort Expo push fan-out. Persisted in-app notifications are the source
 * of truth; this just wakes closed/backgrounded devices. Tokens Expo reports
 * as unregistered are pruned.
 */
export async function sendExpoPushToUsersService(
  userIds: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (userIds.length === 0) return;

  const fetchFn: ((url: string, init: unknown) => Promise<any>) | undefined = (
    globalThis as any
  ).fetch;
  if (typeof fetchFn !== "function") return;

  const rows = await prisma.pushToken.findMany({
    where: { userId: { in: userIds } },
    select: { token: true },
  });
  const tokens = [...new Set(rows.map((r) => r.token))].filter(isExpoToken);
  if (tokens.length === 0) return;

  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: "default",
    channelId: "default",
    priority: "high",
  }));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  }

  const deadTokens: string[] = [];

  for (const batch of chunk(messages, 100)) {
    try {
      const res = await fetchFn(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(batch),
      });
      const json = await res.json().catch(() => null);
      const tickets = json?.data;
      if (Array.isArray(tickets)) {
        tickets.forEach((ticket: any, i: number) => {
          if (
            ticket?.status === "error" &&
            ticket?.details?.error === "DeviceNotRegistered"
          ) {
            const dead = batch[i]?.to;
            if (dead) deadTokens.push(dead);
          }
        });
      }
    } catch {
      // Network/credential failure — in-app notification still delivered.
    }
  }

  if (deadTokens.length > 0) {
    await prisma.pushToken
      .deleteMany({ where: { token: { in: deadTokens } } })
      .catch(() => undefined);
  }
}
