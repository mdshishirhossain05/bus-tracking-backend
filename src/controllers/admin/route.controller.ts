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

  const route = await prisma.route.findUnique({
    where: { id },
    select: {
      isActive: true,
      _count: { select: { trips: true, serviceSchedules: true } },
    },
  });

  if (!route) {
    return res.status(404).json({ message: "Route not found" });
  }

  // A trip currently in progress must be ended before the route is removed.
  const runningTrips = await prisma.trip.count({
    where: { routeId: id, status: "RUNNING" },
  });

  if (runningTrips > 0) {
    return res.status(409).json({
      message:
        "This route has a trip in progress. End the active trip before removing the route.",
      code: "ROUTE_HAS_RUNNING_TRIP",
    });
  }

  // Trips and service schedules are history-bearing references. When they
  // exist the route is archived (kept for historical records) instead of
  // hard-deleted, so past trip data is never lost.
  const hasHistory =
    route._count.trips > 0 || route._count.serviceSchedules > 0;

  if (hasHistory) {
    if (!route.isActive) {
      return res.json({
        message: "Route is already archived.",
        archived: true,
      });
    }

    await prisma.route.update({ where: { id }, data: { isActive: false } });

    return res.json({
      message:
        "This route has trip history, so it was archived instead of deleted. It will no longer be available for new trips.",
      archived: true,
    });
  }

  await prisma.route.delete({ where: { id } });

  return res.json({ message: "Route deleted successfully.", archived: false });
}
