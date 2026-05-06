import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/apiResponse.js";
import { AppError } from "../../utils/appError.js";
import { uuidParamSchema } from "../../validators/params.validators.js";
import {
  createServiceScheduleSchema,
  listServiceSchedulesQuerySchema,
  updateServiceScheduleSchema,
} from "../../validators/serviceSchedule.validators.js";
import {
  archiveServiceScheduleService,
  createServiceScheduleService,
  deleteServiceScheduleService,
  getServiceScheduleByIdService,
  listServiceSchedulesService,
  permanentlyDeleteArchivedServiceScheduleService,
  restoreServiceScheduleService,
  updateServiceScheduleService,
} from "../../services/serviceSchedule.service.js";
import { writeAuditLog, getRequestIp } from "../../services/audit.service.js";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";

async function writeServiceScheduleAudit(
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
    entityType: "ServiceSchedule",
    entityId: params.entityId ?? null,
    route: req.originalUrl,
    method: req.method,
    requestId: req.requestId ?? null,
    ip: getRequestIp(req),
    userAgent: req.headers["user-agent"]?.toString() ?? null,
    metaJson: params.metaJson ?? null,
  });
}

export const createServiceSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = createServiceScheduleSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const created = await createServiceScheduleService(parsed.data);

    await writeServiceScheduleAudit(req, {
      action: "ADMIN_CREATE_SERVICE_SCHEDULE",
      entityId: created.id,
      metaJson: {
        routeId: created.routeId,
        busId: created.busId,
        driverId: created.driverId,
        dayType: created.dayType,
        departureTime: created.departureTime,
        isActive: created.isActive,
      },
    });

    return sendSuccess(res, {
      statusCode: 201,
      message: "Service schedule created successfully",
      data: created,
    });
  },
);

export const listServiceSchedules = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = listServiceSchedulesQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_QUERY",
        message: "Invalid query parameters",
        details: parsed.error.format(),
      });
    }

    const result = await listServiceSchedulesService(parsed.data);

    await writeServiceScheduleAudit(req, {
      action: "ADMIN_LIST_SERVICE_SCHEDULES",
      metaJson: parsed.data,
    });

    return sendSuccess(res, {
      message: "Service schedules fetched successfully",
      data: result,
    });
  },
);

export const getServiceScheduleById = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = uuidParamSchema.safeParse(req.params.id);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_SERVICE_SCHEDULE_ID",
        message: "Invalid service schedule id",
      });
    }

    const item = await getServiceScheduleByIdService(parsed.data);

    await writeServiceScheduleAudit(req, {
      action: "ADMIN_GET_SERVICE_SCHEDULE",
      entityId: parsed.data,
    });

    return sendSuccess(res, {
      message: "Service schedule fetched successfully",
      data: item,
    });
  },
);

export const updateServiceSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const idParsed = uuidParamSchema.safeParse(req.params.id);

    if (!idParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_SERVICE_SCHEDULE_ID",
        message: "Invalid service schedule id",
      });
    }

    const bodyParsed = updateServiceScheduleSchema.safeParse(req.body);

    if (!bodyParsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: bodyParsed.error.format(),
      });
    }

    const updated = await updateServiceScheduleService(
      idParsed.data,
      bodyParsed.data,
    );

    await writeServiceScheduleAudit(req, {
      action: "ADMIN_UPDATE_SERVICE_SCHEDULE",
      entityId: updated.id,
      metaJson: bodyParsed.data,
    });

    return sendSuccess(res, {
      message: "Service schedule updated successfully",
      data: updated,
    });
  },
);

export const archiveServiceSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = uuidParamSchema.safeParse(req.params.id);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_SERVICE_SCHEDULE_ID",
        message: "Invalid service schedule id",
      });
    }

    const result = await archiveServiceScheduleService(parsed.data);

    await writeServiceScheduleAudit(req, {
      action: "ADMIN_ARCHIVE_SERVICE_SCHEDULE",
      entityId: parsed.data,
      metaJson: {
        alreadyArchived: result.alreadyArchived,
      },
    });

    return sendSuccess(res, {
      message: result.alreadyArchived
        ? "Service schedule is already archived"
        : "Service schedule archived successfully",
      data: result,
    });
  },
);

export const restoreServiceSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = uuidParamSchema.safeParse(req.params.id);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_SERVICE_SCHEDULE_ID",
        message: "Invalid service schedule id",
      });
    }

    const result = await restoreServiceScheduleService(parsed.data);

    await writeServiceScheduleAudit(req, {
      action: "ADMIN_RESTORE_SERVICE_SCHEDULE",
      entityId: parsed.data,
      metaJson: {
        alreadyRestored: result.alreadyRestored,
      },
    });

    return sendSuccess(res, {
      message: result.alreadyRestored
        ? "Service schedule is already active"
        : "Service schedule restored successfully",
      data: result,
    });
  },
);

export const permanentlyDeleteArchivedServiceSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = uuidParamSchema.safeParse(req.params.id);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_SERVICE_SCHEDULE_ID",
        message: "Invalid service schedule id",
      });
    }

    const result = await permanentlyDeleteArchivedServiceScheduleService(
      parsed.data,
    );

    await writeServiceScheduleAudit(req, {
      action: "ADMIN_PERMANENT_DELETE_SERVICE_SCHEDULE",
      entityId: parsed.data,
      metaJson: result,
    });

    return sendSuccess(res, {
      message: "Archived service schedule permanently deleted successfully",
      data: result,
    });
  },
);

export const deleteServiceSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = uuidParamSchema.safeParse(req.params.id);

    if (!parsed.success) {
      throw new AppError({
        statusCode: 400,
        code: "INVALID_SERVICE_SCHEDULE_ID",
        message: "Invalid service schedule id",
      });
    }

    const result = await deleteServiceScheduleService(parsed.data);

    await writeServiceScheduleAudit(req, {
      action: result.deleted
        ? "ADMIN_DELETE_SERVICE_SCHEDULE"
        : "ADMIN_ARCHIVE_SERVICE_SCHEDULE",
      entityId: parsed.data,
      metaJson: {
        deleted: result.deleted,
        archived: result.archived,
      },
    });

    return sendSuccess(res, {
      message: result.deleted
        ? "Service schedule deleted successfully"
        : "Service schedule has trip history, so it was archived instead of being permanently deleted",
      data: result,
    });
  },
);
