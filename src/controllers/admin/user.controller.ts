import type { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";
import { sendSuccess } from "../../utils/apiResponse.js";
import { AppError } from "../../utils/appError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { uuidParamSchema } from "../../validators/params.validators.js";
import {
  approvePassengerSchema,
  createAdminUserSchema,
  listAdminUsersQuerySchema,
  rejectPassengerSchema,
  updateAdminUserRoleSchema,
  updateAdminUserSchema,
  updateAdminUserStatusSchema,
  updateRegistrationSettingsSchema,
} from "../../validators/adminUser.validators.js";
import {
  approvePassengerService,
  createAdminUserService,
  deleteUserService,
  getAdminUserByIdService,
  getRegistrationSettingsService,
  listAdminUsersService,
  rejectPassengerService,
  searchUsersService,
  updateAdminUserRoleService,
  updateAdminUserService,
  updateAdminUserStatusService,
  updateRegistrationSettingsService,
  listSessionsByUserId,
} from "../../services/adminUser.service.js";
import { writeAuditLog, getRequestIp } from "../../services/audit.service.js";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";

async function writeAdminAudit(
  req: Request,
  params: {
    action: string;
    entityId?: string | null;
    metaJson?: Record<string, unknown> | null;
  },
) {
  const actor = (req as AuthRequest).user;

  await writeAuditLog({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    action: params.action,
    entityType: "User",
    entityId: params.entityId ?? null,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    metaJson: params.metaJson ?? null,
  });
}

export const adminListUsers = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = listAdminUsersQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_QUERY",
        message: "Invalid query parameters",
        details: parsed.error.format(),
      });
    }

    const result = await listAdminUsersService(parsed.data);

    await writeAdminAudit(req, {
      action: "ADMIN_LIST_USERS",
      metaJson: parsed.data,
    });

    return sendSuccess(res, {
      message: "Users fetched successfully",
      data: result,
    });
  },
);

export const adminSearchUsers = asyncHandler(
  async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (q.length < 2) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_SEARCH_QUERY",
        message: "Query must be at least 2 characters",
      });
    }

    const users = await searchUsersService(q);

    await writeAdminAudit(req, {
      action: "ADMIN_SEARCH_USERS",
      metaJson: { q },
    });

    return sendSuccess(res, {
      message: "Users fetched successfully",
      data: { items: users },
    });
  },
);

export const adminGetUserById = asyncHandler(
  async (req: Request, res: Response) => {
    const idParsed = uuidParamSchema.safeParse(req.params.id);

    if (!idParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_USER_ID",
        message: "Invalid user id",
      });
    }

    const user = await getAdminUserByIdService(idParsed.data);

    await writeAdminAudit(req, {
      action: "ADMIN_GET_USER",
      entityId: idParsed.data,
    });

    return sendSuccess(res, {
      message: "User fetched successfully",
      data: user,
    });
  },
);

export const adminCreateUser = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = createAdminUserSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const created = await createAdminUserService(parsed.data);

    await writeAdminAudit(req, {
      action: "ADMIN_CREATE_USER",
      entityId: created.id,
      metaJson: {
        email: created.email,
        role: created.role,
        isActive: created.isActive,
        approvalStatus: created.approvalStatus,
        registrationSource: created.registrationSource,
      },
    });

    return sendSuccess(res, {
      statusCode: 201,
      message: "User created successfully",
      data: created,
    });
  },
);

export const adminUpdateUser = asyncHandler(
  async (req: Request, res: Response) => {
    const idParsed = uuidParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_USER_ID",
        message: "Invalid user id",
      });
    }

    const parsed = updateAdminUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const updated = await updateAdminUserService(idParsed.data, parsed.data);

    await writeAdminAudit(req, {
      action: "ADMIN_UPDATE_USER",
      entityId: updated.id,
      metaJson: parsed.data,
    });

    return sendSuccess(res, {
      message: "User updated successfully",
      data: updated,
    });
  },
);

export const adminUpdateUserRole = asyncHandler(
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const idParsed = uuidParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_USER_ID",
        message: "Invalid user id",
      });
    }

    const parsed = updateAdminUserRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const updated = await updateAdminUserRoleService(
      { id: authReq.user!.id, role: authReq.user!.role },
      idParsed.data,
      parsed.data,
    );

    await writeAdminAudit(req, {
      action: "ADMIN_UPDATE_USER_ROLE",
      entityId: updated.id,
      metaJson: { newRole: updated.role },
    });

    return sendSuccess(res, {
      message: "User role updated successfully",
      data: updated,
    });
  },
);

export const adminUpdateUserStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const idParsed = uuidParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_USER_ID",
        message: "Invalid user id",
      });
    }

    const parsed = updateAdminUserStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const updated = await updateAdminUserStatusService(
      { id: authReq.user!.id, role: authReq.user!.role },
      idParsed.data,
      parsed.data,
    );

    await writeAdminAudit(req, {
      action: "ADMIN_UPDATE_USER_STATUS",
      entityId: updated.id,
      metaJson: { isActive: updated.isActive },
    });

    return sendSuccess(res, {
      message: "User status updated successfully",
      data: updated,
    });
  },
);

export const adminApprovePassenger = asyncHandler(
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const idParsed = uuidParamSchema.safeParse(req.params.id);

    if (!idParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_USER_ID",
        message: "Invalid user id",
      });
    }

    const parsed = approvePassengerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const updated = await approvePassengerService(
      { id: authReq.user!.id, role: authReq.user!.role },
      idParsed.data,
      parsed.data,
    );

    await writeAdminAudit(req, {
      action: "ADMIN_APPROVE_PASSENGER",
      entityId: updated.id,
      metaJson: {
        approvalStatus: updated.approvalStatus,
        note: parsed.data.note ?? null,
      },
    });

    return sendSuccess(res, {
      message: "Passenger approved successfully",
      data: updated,
    });
  },
);

export const adminRejectPassenger = asyncHandler(
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const idParsed = uuidParamSchema.safeParse(req.params.id);

    if (!idParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_USER_ID",
        message: "Invalid user id",
      });
    }

    const parsed = rejectPassengerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const updated = await rejectPassengerService(
      { id: authReq.user!.id, role: authReq.user!.role },
      idParsed.data,
      parsed.data,
    );

    await writeAdminAudit(req, {
      action: "ADMIN_REJECT_PASSENGER",
      entityId: updated.id,
      metaJson: {
        approvalStatus: updated.approvalStatus,
        reason: parsed.data.reason,
      },
    });

    return sendSuccess(res, {
      message: "Passenger rejected successfully",
      data: updated,
    });
  },
);

export const adminDeleteUser = asyncHandler(
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const idParsed = uuidParamSchema.safeParse(req.params.id);

    if (!idParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_USER_ID",
        message: "Invalid user id",
      });
    }

    const result = await deleteUserService(
      { id: authReq.user!.id, role: authReq.user!.role },
      idParsed.data,
    );

    await writeAdminAudit(req, {
      action: "ADMIN_DELETE_USER",
      entityId: idParsed.data,
    });

    return sendSuccess(res, {
      message: "User deleted successfully",
      data: result,
    });
  },
);

export const adminGetRegistrationSettings = asyncHandler(
  async (req: Request, res: Response) => {
    const config = await getRegistrationSettingsService();

    await writeAdminAudit(req, {
      action: "ADMIN_GET_REGISTRATION_SETTINGS",
      entityId: null,
    });

    return sendSuccess(res, {
      message: "Registration settings fetched successfully",
      data: config,
    });
  },
);

export const adminUpdateRegistrationSettings = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = updateRegistrationSettingsSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const config = await updateRegistrationSettingsService(parsed.data);

    await writeAdminAudit(req, {
      action: "ADMIN_UPDATE_REGISTRATION_SETTINGS",
      entityId: null,
      metaJson: parsed.data,
    });

    return sendSuccess(res, {
      message: "Registration settings updated successfully",
      data: config,
    });
  },
);

export const adminUserSessionDashboard = asyncHandler(
  async (req: Request, res: Response) => {
    const idParsed = uuidParamSchema.safeParse(req.params.userId);

    if (!idParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_USER_ID",
        message: "Invalid user id",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: idParsed.data },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        approvalStatus: true,
        registrationSource: true,
      },
    });

    if (!user) {
      throw new AppError({
        statusCode: 404,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    const sessions = await listSessionsByUserId(idParsed.data);

    await writeAdminAudit(req, {
      action: "ADMIN_VIEW_USER_SESSION_DASHBOARD",
      entityId: idParsed.data,
    });

    return sendSuccess(res, {
      message: "User session dashboard fetched successfully",
      data: {
        user,
        sessions: sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          ipFirst: s.ipFirst,
          ipLast: s.ipLast,
          lastSeenIp: s.lastSeenIp,
          deviceLabel: s.deviceLabel,
          userAgentRaw: s.userAgentRaw,
          refreshFamilyId: s.refreshFamilyId,
          roleSnapshot: s.roleSnapshot,
          isCurrent: s.isCurrent,
          revokedAt: s.revokedAt,
          revokedReason: s.revokedReason,
          active: s.revokedAt == null,
        })),
      },
    });
  },
);
