import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import {
  createRouteSchema,
  updateRouteSchema,
} from "../../validators/route.validators.js";
import { uuidParamSchema } from "../../validators/params.validators.js";
import { cleanUndefined } from "../../utils/clean.js";

export async function createRoute(req: Request, res: Response) {
  const parsed = createRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid data",
      errors: parsed.error.format(),
    });
  }

  const data = cleanUndefined(parsed.data);

  try {
    const route = await prisma.route.create({ data });
    return res.status(201).json({ route });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        message: "Route name already exists",
      });
    }

    throw error;
  }
}

export async function listRoutes(_req: Request, res: Response) {
  const routes = await prisma.route.findMany({
    orderBy: { createdAt: "desc" },
  });

  return res.json({ routes });
}

export async function updateRoute(req: Request, res: Response) {
  const idParsed = uuidParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const parsed = updateRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid data",
      errors: parsed.error.format(),
    });
  }

  const data = cleanUndefined(parsed.data);

  try {
    const route = await prisma.route.update({
      where: { id: idParsed.data },
      data,
    });

    return res.json({ route });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        message: "Route name already exists",
      });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.status(404).json({ message: "Route not found" });
    }

    throw error;
  }
}

export async function deleteRoute(req: Request, res: Response) {
  const idParsed = uuidParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const id = idParsed.data;

  const dependencies = await prisma.route.findUnique({
    where: { id },
    select: {
      _count: {
        select: {
          routeStops: true,
          trips: true,
          schedules: true,
          serviceSchedules: true,
          tripEvents: true,
        },
      },
    },
  });

  if (!dependencies) {
    return res.status(404).json({ message: "Route not found" });
  }

  const { routeStops, trips, schedules, serviceSchedules, tripEvents } =
    dependencies._count;

  if (
    routeStops > 0 ||
    trips > 0 ||
    schedules > 0 ||
    serviceSchedules > 0 ||
    tripEvents > 0
  ) {
    return res.status(409).json({
      message: "Route cannot be deleted because it is in use",
      dependencies: {
        routeStops,
        trips,
        schedules,
        serviceSchedules,
        tripEvents,
      },
    });
  }

  await prisma.route.delete({ where: { id } });

  return res.json({ message: "Route deleted successfully" });
}
