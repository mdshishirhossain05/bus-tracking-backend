import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";

export async function writeAuditLog(input: {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  route?: string | null;
  method?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  metaJson?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      actorRole: (input.actorRole as any) ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      route: input.route ?? null,
      method: input.method ?? null,
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      beforeJson: input.beforeJson as any,
      afterJson: input.afterJson as any,
      metaJson: input.metaJson as any,
    },
  });
}

export async function writeAuditLogSafe(input: {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  route?: string | null;
  method?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  metaJson?: unknown;
}) {
  try {
    await writeAuditLog(input);
  } catch (err) {
    logger.error(
      {
        err,
        auditAction: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        requestId: input.requestId ?? null,
      },
      "audit log write failed",
    );
  }
}

export function getRequestIp(req: {
  headers: Record<string, unknown>;
  ip: string | undefined;
}) {
  const xf = req.headers["x-forwarded-for"];

  if (typeof xf === "string" && xf.length > 0) {
    return xf.split(",")[0]?.trim() ?? req.ip ?? null;
  }

  return req.ip ?? null;
}
