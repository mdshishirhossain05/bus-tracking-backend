import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import {
  createScheduleSchema,
  updateScheduleSchema,
} from "../../validators/schedule.validators.js";
import { uuidParamSchema } from "../../validators/params.validators.js";

function parseTimeToDate(timeStr: string): Date {
  const parts = timeStr.split(":").map((x) => Number(x));
  const [hh, mm, ss = 0] = parts;
  return new Date(Date.UTC(1970, 0, 1, hh, mm, ss, 0));
}

export async function createSchedule(req: Request, res: Response) {
  const parsed = createScheduleSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid data",
      errors: parsed.error.format(),
    });
  }

  try {
    const schedule = await prisma.schedule.create({
      data: {
        routeId: parsed.data.routeId,
        stopId: parsed.data.stopId,
        dayType: parsed.data.dayType,
        scheduledTime: parseTimeToDate(parsed.data.scheduledTime),
      },
    });

    return res.status(201).json({ schedule });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        message:
          "A schedule for this route, stop, day, and time already exists",
      });
    }

    throw error;
  }
}

export async function listSchedules(_req: Request, res: Response) {
  const schedules = await prisma.schedule.findMany({
    orderBy: [{ dayType: "asc" }, { scheduledTime: "asc" }],
    include: {
      route: true,
      stop: true,
    },
  });

  return res.json({ schedules });
}

export async function updateSchedule(req: Request, res: Response) {
  const idParsed = uuidParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const parsed = updateScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid data",
      errors: parsed.error.format(),
    });
  }

  const data: {
    routeId?: string;
    stopId?: string;
    dayType?:
      | "SUNDAY"
      | "MONDAY"
      | "TUESDAY"
      | "WEDNESDAY"
      | "THURSDAY"
      | "FRIDAY"
      | "SATURDAY";
    scheduledTime?: Date;
  } = {};

  if (parsed.data.routeId !== undefined) data.routeId = parsed.data.routeId;
  if (parsed.data.stopId !== undefined) data.stopId = parsed.data.stopId;
  if (parsed.data.dayType !== undefined) data.dayType = parsed.data.dayType;
  if (parsed.data.scheduledTime !== undefined) {
    data.scheduledTime = parseTimeToDate(parsed.data.scheduledTime);
  }

  try {
    const schedule = await prisma.schedule.update({
      where: { id: idParsed.data },
      data,
    });

    return res.json({ schedule });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        message:
          "A schedule for this route, stop, day, and time already exists",
      });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    throw error;
  }
}

export async function deleteSchedule(req: Request, res: Response) {
  const idParsed = uuidParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ message: "Invalid id" });
  }

  try {
    await prisma.schedule.delete({
      where: { id: idParsed.data },
    });

    return res.json({ message: "Schedule deleted successfully" });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    throw error;
  }
}
