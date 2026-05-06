import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";
import {
  createStopSchema,
  updateStopSchema,
} from "../../validators/stop.validators.js";
import { uuidParamSchema } from "../../validators/params.validators.js";
import { cleanUndefined } from "../../utils/clean.js";

function setNoStore(res: Response) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function normalizeOptionalString(value?: string) {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapStop(stop: {
  id: string;
  stopName: string;
  stopCode: string | null;
  landmark: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  lat: unknown;
  lng: unknown;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    routeStops: number;
    schedules: number;
    stopArrivals: number;
  };
}) {
  return {
    id: stop.id,
    stopName: stop.stopName,
    stopCode: stop.stopCode,
    landmark: stop.landmark,
    address: stop.address,
    notes: stop.notes,
    isActive: stop.isActive,
    lat: Number(stop.lat),
    lng: Number(stop.lng),
    createdAt: stop.createdAt,
    updatedAt: stop.updatedAt,
    usageSummary: stop._count
      ? {
          routeStops: stop._count.routeStops,
          schedules: stop._count.schedules,
          stopArrivals: stop._count.stopArrivals,
        }
      : undefined,
  };
}

function isUniqueConstraintError(error: unknown, field?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  if (!field) return true;

  const target = Array.isArray(error.meta?.target)
    ? error.meta?.target
    : typeof error.meta?.target === "string"
      ? [error.meta.target]
      : [];

  return target.includes(field);
}

function isRecordNotFoundError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

export async function createStop(req: Request, res: Response) {
  setNoStore(res);

  const parsed = createStopSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid data",
      errors: parsed.error.format(),
    });
  }

  const data = cleanUndefined({
    stopName: parsed.data.stopName.trim(),
    stopCode: normalizeOptionalString(parsed.data.stopCode),
    landmark: normalizeOptionalString(parsed.data.landmark),
    address: normalizeOptionalString(parsed.data.address),
    notes: normalizeOptionalString(parsed.data.notes),
    isActive: parsed.data.isActive ?? true,
    lat: parsed.data.lat,
    lng: parsed.data.lng,
  });

  try {
    const stop = await prisma.stop.create({
      data,
      include: {
        _count: {
          select: {
            routeStops: true,
            schedules: true,
            stopArrivals: true,
          },
        },
      },
    });

    return res.status(201).json({ stop: mapStop(stop) });
  } catch (error) {
    if (isUniqueConstraintError(error, "stopCode")) {
      return res.status(409).json({
        message: "Stop code already exists",
      });
    }

    throw error;
  }
}

export async function listStops(_req: Request, res: Response) {
  setNoStore(res);

  const stops = await prisma.stop.findMany({
    orderBy: [{ isActive: "desc" }, { stopName: "asc" }],
    include: {
      _count: {
        select: {
          routeStops: true,
          schedules: true,
          stopArrivals: true,
        },
      },
    },
  });

  return res.json({
    stops: stops.map(mapStop),
  });
}

export async function getStopUsage(req: Request, res: Response) {
  setNoStore(res);

  const idParsed = uuidParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const stop = await prisma.stop.findUnique({
    where: { id: idParsed.data },
    include: {
      routeStops: {
        orderBy: [{ route: { routeName: "asc" } }, { stopOrder: "asc" }],
        include: {
          route: {
            select: {
              id: true,
              routeName: true,
              isActive: true,
            },
          },
        },
      },
      _count: {
        select: {
          routeStops: true,
          schedules: true,
          stopArrivals: true,
        },
      },
    },
  });

  if (!stop) {
    return res.status(404).json({ message: "Stop not found" });
  }

  return res.json({
    usage: {
      stop: mapStop(stop),
      canDelete:
        stop._count.routeStops === 0 &&
        stop._count.schedules === 0 &&
        stop._count.stopArrivals === 0,
      routeUsages: stop.routeStops.map((item) => ({
        routeId: item.route.id,
        routeName: item.route.routeName,
        routeIsActive: item.route.isActive,
        stopOrder: item.stopOrder,
      })),
      summary: {
        routeStops: stop._count.routeStops,
        schedules: stop._count.schedules,
        stopArrivals: stop._count.stopArrivals,
      },
    },
  });
}

export async function updateStop(req: Request, res: Response) {
  setNoStore(res);

  const idParsed = uuidParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const parsed = updateStopSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid data",
      errors: parsed.error.format(),
    });
  }

  const data = cleanUndefined({
    ...(parsed.data.stopName !== undefined
      ? { stopName: parsed.data.stopName.trim() }
      : {}),
    ...(parsed.data.stopCode !== undefined
      ? { stopCode: normalizeOptionalString(parsed.data.stopCode) }
      : {}),
    ...(parsed.data.landmark !== undefined
      ? { landmark: normalizeOptionalString(parsed.data.landmark) }
      : {}),
    ...(parsed.data.address !== undefined
      ? { address: normalizeOptionalString(parsed.data.address) }
      : {}),
    ...(parsed.data.notes !== undefined
      ? { notes: normalizeOptionalString(parsed.data.notes) }
      : {}),
    ...(parsed.data.isActive !== undefined
      ? { isActive: parsed.data.isActive }
      : {}),
    ...(parsed.data.lat !== undefined ? { lat: parsed.data.lat } : {}),
    ...(parsed.data.lng !== undefined ? { lng: parsed.data.lng } : {}),
  });

  try {
    const stop = await prisma.stop.update({
      where: { id: idParsed.data },
      data,
      include: {
        _count: {
          select: {
            routeStops: true,
            schedules: true,
            stopArrivals: true,
          },
        },
      },
    });

    return res.json({ stop: mapStop(stop) });
  } catch (error) {
    if (isUniqueConstraintError(error, "stopCode")) {
      return res.status(409).json({
        message: "Stop code already exists",
      });
    }

    if (isRecordNotFoundError(error)) {
      return res.status(404).json({ message: "Stop not found" });
    }

    throw error;
  }
}

export async function deleteStop(req: Request, res: Response) {
  setNoStore(res);

  const idParsed = uuidParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const id = idParsed.data;

  const stop = await prisma.stop.findUnique({
    where: { id },
    select: {
      id: true,
      stopName: true,
      stopCode: true,
      lat: true,
      lng: true,
      _count: {
        select: {
          routeStops: true,
          schedules: true,
          stopArrivals: true,
        },
      },
    },
  });

  if (!stop) {
    return res.json({
      message: "Stop was already deleted.",
      deleted: false,
      alreadyDeleted: true,
      stopId: id,
    });
  }

  const { routeStops, schedules, stopArrivals } = stop._count;

  if (routeStops > 0 || schedules > 0 || stopArrivals > 0) {
    return res.status(409).json({
      message: "Stop cannot be deleted because it is in use",
      dependencies: {
        routeStops,
        schedules,
        stopArrivals,
      },
    });
  }

  await prisma.stop.delete({
    where: { id },
  });

  const stillExists = await prisma.stop.findUnique({
    where: { id },
    select: { id: true },
  });

  if (stillExists) {
    return res.status(500).json({
      message:
        "Stop delete operation did not persist. Please check database connection and deployment environment.",
      stopId: id,
    });
  }

  return res.json({
    message: "Stop deleted successfully",
    deleted: true,
    alreadyDeleted: false,
    stopId: id,
    deletedStop: {
      id: stop.id,
      stopName: stop.stopName,
      stopCode: stop.stopCode,
      lat: Number(stop.lat),
      lng: Number(stop.lng),
    },
  });
}
