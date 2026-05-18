import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import type { ListAuditLogsQuery } from "../validators/auditLog.validators.js";

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildAuditWhere(query: ListAuditLogsQuery): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (query.action) {
    where.action = { contains: query.action, mode: "insensitive" };
  }
  if (query.entityType) {
    where.entityType = { contains: query.entityType, mode: "insensitive" };
  }
  if (query.actorUserId) where.actorUserId = query.actorUserId;
  if (query.entityId) where.entityId = query.entityId;

  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from || to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;
    where.createdAt = createdAt;
  }

  return where;
}

export async function listAuditLogsService(query: ListAuditLogsQuery) {
  const { page, limit } = query;
  const skip = (page - 1) * limit;
  const where = buildAuditWhere(query);

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditLog.count({ where }),
  ]);

  // The AuditLog table stores only actorUserId; resolve actor display
  // details in a single follow-up query.
  const actorIds = [
    ...new Set(
      logs
        .map((log) => log.actorUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, fullName: true, email: true },
      })
    : [];
  const actorMap = new Map(actors.map((actor) => [actor.id, actor]));

  return {
    items: logs.map((log) => {
      const actor = log.actorUserId ? actorMap.get(log.actorUserId) : null;
      return {
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        actorUserId: log.actorUserId,
        actorRole: log.actorRole,
        actorName: actor?.fullName ?? null,
        actorEmail: actor?.email ?? null,
        route: log.route,
        method: log.method,
        ip: log.ip,
        requestId: log.requestId,
        metaJson: log.metaJson,
        createdAt: log.createdAt.toISOString(),
      };
    }),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
