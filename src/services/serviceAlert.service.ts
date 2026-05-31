import type { ServiceAlertSeverity } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/appError.js";

export type ServiceAlertRecord = {
  id: string;
  title: string;
  body: string;
  severity: ServiceAlertSeverity;
  routeId: string | null;
  routeName: string | null;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
};

function isValidSeverity(value: unknown): value is ServiceAlertSeverity {
  return value === "INFO" || value === "WARNING" || value === "CRITICAL";
}

function shape(row: {
  id: string;
  title: string;
  body: string;
  severity: ServiceAlertSeverity;
  routeId: string | null;
  validFrom: Date;
  validUntil: Date | null;
  isActive: boolean;
  createdAt: Date;
  route?: { routeName: string } | null;
}): ServiceAlertRecord {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    routeId: row.routeId,
    routeName: row.route?.routeName ?? null,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Active alerts: isActive=true AND we're inside the validity window
 * (validFrom <= now < validUntil, or validUntil=null = open ended).
 * Optionally narrowed to a specific route — alerts with routeId=null
 * (global) always come back.
 */
export async function listActiveAlertsService(
  routeId?: string | null,
): Promise<ServiceAlertRecord[]> {
  const now = new Date();
  const rows = await prisma.serviceAlert.findMany({
    where: {
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      ...(routeId
        ? { OR: [{ routeId: null }, { routeId }] }
        : {}),
    },
    include: { route: { select: { routeName: true } } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 20,
  });
  return rows.map(shape);
}

export async function listAllAlertsService(): Promise<ServiceAlertRecord[]> {
  const rows = await prisma.serviceAlert.findMany({
    include: { route: { select: { routeName: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(shape);
}

type AlertInput = {
  title: string;
  body: string;
  severity?: unknown;
  routeId?: string | null;
  validFrom?: string;
  validUntil?: string | null;
  isActive?: boolean;
};

function validateInput(input: AlertInput) {
  const title = (input.title ?? "").toString().trim();
  const body = (input.body ?? "").toString().trim();
  if (!title || !body) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_ALERT",
      message: "Title and body are required",
    });
  }
  const severity: ServiceAlertSeverity = isValidSeverity(input.severity)
    ? input.severity
    : "INFO";

  const validFrom = input.validFrom
    ? new Date(input.validFrom)
    : new Date();
  const validUntil =
    input.validUntil != null && input.validUntil !== ""
      ? new Date(input.validUntil)
      : null;

  if (Number.isNaN(validFrom.getTime())) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_VALID_FROM",
      message: "validFrom is not a valid date",
    });
  }
  if (validUntil && Number.isNaN(validUntil.getTime())) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_VALID_UNTIL",
      message: "validUntil is not a valid date",
    });
  }
  if (validUntil && validUntil <= validFrom) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_WINDOW",
      message: "validUntil must be after validFrom",
    });
  }

  return {
    title,
    body,
    severity,
    routeId: typeof input.routeId === "string" ? input.routeId : null,
    validFrom,
    validUntil,
    isActive: input.isActive ?? true,
  };
}

export async function createAlertService(
  authorId: string,
  input: AlertInput,
): Promise<ServiceAlertRecord> {
  const data = validateInput(input);
  const row = await prisma.serviceAlert.create({
    data: { ...data, createdByUserId: authorId },
    include: { route: { select: { routeName: true } } },
  });
  return shape(row);
}

export async function updateAlertService(
  id: string,
  input: AlertInput,
): Promise<ServiceAlertRecord> {
  const data = validateInput(input);
  const row = await prisma.serviceAlert.update({
    where: { id },
    data,
    include: { route: { select: { routeName: true } } },
  });
  return shape(row);
}

export async function deleteAlertService(id: string): Promise<void> {
  await prisma.serviceAlert.delete({ where: { id } });
}
