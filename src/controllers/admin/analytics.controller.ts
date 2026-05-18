import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/apiResponse.js";
import { AppError } from "../../utils/appError.js";
import { delayReportQuerySchema } from "../../validators/analytics.validators.js";
import { getDelayReportService } from "../../services/analytics.service.js";

export async function getAdminDelayReport(req: Request, res: Response) {
  const parsed = delayReportQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_QUERY",
      message: "Invalid delay report query parameters",
      details: parsed.error.format(),
    });
  }

  const data = await getDelayReportService(parsed.data);

  return sendSuccess(res, {
    message: "Delay report fetched successfully",
    data,
  });
}
