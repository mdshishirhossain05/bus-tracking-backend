import type { Request } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { writeAuditLogSafe, getRequestIp } from "../services/audit.service.js";

/**
 * Records an audit log entry for the current request. Best-effort:
 * `writeAuditLogSafe` swallows failures so auditing never breaks the
 * underlying operation.
 */
export async function writeRequestAudit(
  req: Request,
  params: {
    action: string;
    entityType: string;
    entityId?: string | null;
    metaJson?: Record<string, unknown> | null;
  },
) {
  const actor = (req as AuthRequest).user;

  await writeAuditLogSafe({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    metaJson: params.metaJson ?? null,
  });
}
