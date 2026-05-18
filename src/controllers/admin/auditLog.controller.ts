import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/apiResponse.js";
import { AppError } from "../../utils/appError.js";
import { listAuditLogsQuerySchema } from "../../validators/auditLog.validators.js";
import { listAuditLogsService } from "../../services/auditLog.service.js";

export async function getAdminAuditLogs(req: Request, res: Response) {
  const parsed = listAuditLogsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_QUERY",
      message: "Invalid audit log query parameters",
      details: parsed.error.format(),
    });
  }

  const data = await listAuditLogsService(parsed.data);

  return sendSuccess(res, {
    message: "Audit logs fetched successfully",
    data,
  });
}
