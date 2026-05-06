import type { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";
import {
  listSessionsByUserId,
  adminRevokeSession,
} from "../../services/auth.service.js";
import { writeAuditLog, getRequestIp } from "../../services/audit.service.js";

export async function adminListUserSessions(req: Request, res: Response) {
  const adminUser = (req as any).user;
  const userId = req.params.userId;

  if (typeof userId !== "string" || userId.trim().length === 0) {
    return res.status(400).json({ message: "Invalid userId" });
  }

  const targetUserId = userId.trim();

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const sessions = await listSessionsByUserId(targetUserId);

  await writeAuditLog({
    actorUserId: adminUser?.id ?? null,
    actorRole: adminUser?.role ?? null,
    action: "ADMIN_VIEWED_USER_SESSIONS",
    entityType: "User",
    entityId: targetUserId,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    metaJson: {
      sessionCount: sessions.length,
    },
  });

  req.log?.info(
    {
      adminUserId: adminUser?.id,
      targetUserId,
      sessionCount: sessions.length,
    },
    "admin viewed user sessions",
  );

  return res.json({
    user,
    sessions: sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      deviceLabel: s.deviceLabel,
      userAgentRaw: s.userAgentRaw,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      ipFirst: s.ipFirst,
      ipLast: s.ipLast,
      lastSeenIp: s.lastSeenIp,
      refreshFamilyId: s.refreshFamilyId,
      roleSnapshot: s.roleSnapshot,
      isCurrent: s.isCurrent,
      revokedAt: s.revokedAt,
      revokedReason: s.revokedReason,
      active: s.revokedAt == null,
    })),
  });
}

export async function adminDeleteSession(req: Request, res: Response) {
  const adminUser = (req as any).user;
  const sessionId = req.params.sessionId;

  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return res.status(400).json({ message: "Invalid sessionId" });
  }

  const targetSessionId = sessionId.trim();

  const session = await prisma.session.findUnique({
    where: { id: targetSessionId },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      revokedReason: true,
    },
  });

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  const revoked = await adminRevokeSession(
    targetSessionId,
    "SESSION_REVOKED_BY_ADMIN",
  );

  if (!revoked && session.revokedAt) {
    return res.json({
      message: "Session already revoked",
      sessionId: targetSessionId,
    });
  }

  await writeAuditLog({
    actorUserId: adminUser?.id ?? null,
    actorRole: adminUser?.role ?? null,
    action: "SESSION_REVOKED_BY_ADMIN",
    entityType: "Session",
    entityId: targetSessionId,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    metaJson: {
      targetUserId: session.userId,
    },
  });

  req.log?.warn(
    {
      adminUserId: adminUser?.id,
      targetSessionId,
      targetUserId: session.userId,
    },
    "admin revoked session",
  );

  return res.json({
    message: "Session revoked by admin",
    sessionId: targetSessionId,
  });
}
