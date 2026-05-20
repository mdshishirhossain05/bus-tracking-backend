import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/appError.js";
import type {
  CreateServiceScheduleInput,
  ListServiceSchedulesQuery,
  UpdateServiceScheduleInput,
} from "../validators/serviceSchedule.validators.js";

function parseTimeToDate(timeStr: string): Date {
  const parts = timeStr.split(":").map((x) => Number(x));
  const [hh, mm, ss = 0] = parts;
  return new Date(Date.UTC(1970, 0, 1, hh, mm, ss, 0));
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}

function buildWhere(
  query: ListServiceSchedulesQuery,
): Prisma.ServiceScheduleWhereInput {
  const where: Prisma.ServiceScheduleWhereInput = {};

  if (query.routeId) where.routeId = query.routeId;
  if (query.busId) where.busId = query.busId;
  if (query.driverId) where.driverId = query.driverId;
  if (query.dayType) where.dayType = query.dayType;
  if (typeof query.isActive === "boolean") where.isActive = query.isActive;

  if (query.search && query.search.trim().length > 0) {
    const search = query.search.trim();

    where.OR = [
      { route: { routeName: { contains: search, mode: "insensitive" } } },
      { bus: { busCode: { contains: search, mode: "insensitive" } } },
      { bus: { plateNumber: { contains: search, mode: "insensitive" } } },
      { driver: { fullName: { contains: search, mode: "insensitive" } } },
      { driver: { email: { contains: search, mode: "insensitive" } } },
      { notes: { contains: search, mode: "insensitive" } },
    ];
  }

  return where;
}

async function ensureOperationalRouteReadiness(routeId: string) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: {
      id: true,
      routeName: true,
      isActive: true,
      routeStops: {
        orderBy: { stopOrder: "asc" },
        select: {
          stopId: true,
          stopOrder: true,
          distanceFromStartKm: true,
        },
      },
    },
  });

  if (!route) {
    throw new AppError({
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: "Route not found",
    });
  }

  if (!route.isActive) {
    throw new AppError({
      statusCode: 400,
      code: "ROUTE_INACTIVE",
      message: "Inactive route cannot be assigned",
    });
  }

  if (route.routeStops.length < 2) {
    throw new AppError({
      statusCode: 400,
      code: "ROUTE_NOT_OPERATIONALLY_READY",
      message:
        "Route must have at least 2 assigned stops before creating a service schedule",
    });
  }

  for (let i = 0; i < route.routeStops.length; i += 1) {
    const current = route.routeStops[i];
    if (!current) continue;

    const expectedOrder = i + 1;

    if (current.stopOrder !== expectedOrder) {
      throw new AppError({
        statusCode: 400,
        code: "ROUTE_STOP_SEQUENCE_INVALID",
        message:
          "Route stop order must be continuous and start from 1 before scheduling",
      });
    }
  }

  const hasAnyDistance = route.routeStops.some(
    (item) => item.distanceFromStartKm != null,
  );
  const hasMissingDistance = route.routeStops.some(
    (item) => item.distanceFromStartKm == null,
  );

  if (hasAnyDistance && hasMissingDistance) {
    throw new AppError({
      statusCode: 400,
      code: "ROUTE_DISTANCE_SERIES_INCOMPLETE",
      message:
        "All route stops must have distanceFromStartKm when distance tracking is used",
    });
  }

  if (hasAnyDistance) {
    let previousDistance = -1;

    for (let i = 0; i < route.routeStops.length; i += 1) {
      const current = route.routeStops[i];
      if (!current) continue;

      const distance = Number(current.distanceFromStartKm ?? 0);

      if (i === 0 && distance !== 0) {
        throw new AppError({
          statusCode: 400,
          code: "ROUTE_FIRST_STOP_DISTANCE_INVALID",
          message: "The first route stop distance must be 0",
        });
      }

      if (distance < previousDistance) {
        throw new AppError({
          statusCode: 400,
          code: "ROUTE_DISTANCE_SEQUENCE_INVALID",
          message:
            "Route stop distanceFromStartKm must be non-decreasing before scheduling",
        });
      }

      previousDistance = distance;
    }
  }
}

async function busHasActiveGpsDevice(busId: string) {
  const assignment = await prisma.busGpsDeviceAssignment.findFirst({
    where: {
      busId,
      isActive: true,
      unassignedAt: null,
    },
    select: { id: true },
  });

  return Boolean(assignment);
}

async function ensureAssignmentEntities(input: {
  routeId: string;
  busId: string;
  driverId: string | null | undefined;
}) {
  const bus = await prisma.bus.findUnique({
    where: { id: input.busId },
    select: { id: true, isActive: true, busCode: true, plateNumber: true },
  });

  await ensureOperationalRouteReadiness(input.routeId);

  if (!bus) {
    throw new AppError({
      statusCode: 404,
      code: "BUS_NOT_FOUND",
      message: "Bus not found",
    });
  }

  if (!bus.isActive) {
    throw new AppError({
      statusCode: 400,
      code: "BUS_INACTIVE",
      message: "Inactive bus cannot be assigned",
    });
  }

  // Driver-less schedules are only allowed when the bus has an active GPS
  // device assignment — the device becomes the schedule's tracking source.
  if (input.driverId == null) {
    if (!(await busHasActiveGpsDevice(input.busId))) {
      throw new AppError({
        statusCode: 400,
        code: "DRIVER_OR_GPS_DEVICE_REQUIRED",
        message:
          "Assign a driver, or attach a GPS device to the bus, before scheduling.",
      });
    }
    return;
  }

  const driver = await prisma.user.findUnique({
    where: { id: input.driverId },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  if (!driver) {
    throw new AppError({
      statusCode: 404,
      code: "DRIVER_NOT_FOUND",
      message: "Driver not found",
    });
  }

  if (!driver.isActive) {
    throw new AppError({
      statusCode: 400,
      code: "DRIVER_INACTIVE",
      message: "Inactive driver cannot be assigned",
    });
  }

  if (driver.role !== "DRIVER") {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_DRIVER_ROLE",
      message: "Assigned user must have DRIVER role",
    });
  }
}

async function ensureNoOperationalConflict(params: {
  excludeId?: string;
  busId: string;
  driverId: string | null | undefined;
  dayType:
    | "SUNDAY"
    | "MONDAY"
    | "TUESDAY"
    | "WEDNESDAY"
    | "THURSDAY"
    | "FRIDAY"
    | "SATURDAY";
  departureTime: string;
}) {
  const departureTimeDate = parseTimeToDate(params.departureTime);

  const whereBase = {
    dayType: params.dayType,
    departureTime: departureTimeDate,
    isActive: true,
    ...(params.excludeId ? { NOT: { id: params.excludeId } } : {}),
  };

  const [busConflict, driverConflict] = await Promise.all([
    prisma.serviceSchedule.findFirst({
      where: {
        ...whereBase,
        busId: params.busId,
      },
      select: {
        id: true,
        bus: { select: { busCode: true } },
        route: { select: { routeName: true } },
      },
    }),
    params.driverId == null
      ? Promise.resolve(null)
      : prisma.serviceSchedule.findFirst({
          where: {
            ...whereBase,
            driverId: params.driverId,
          },
          select: {
            id: true,
            driver: { select: { fullName: true } },
            route: { select: { routeName: true } },
          },
        }),
  ]);

  if (busConflict) {
    throw new AppError({
      statusCode: 409,
      code: "BUS_SCHEDULE_CONFLICT",
      message:
        "Bus is already assigned to another active schedule at this day and time",
      details: {
        conflictingScheduleId: busConflict.id,
        busCode: busConflict.bus.busCode,
        routeName: busConflict.route.routeName,
      },
    });
  }

  if (driverConflict && driverConflict.driver) {
    throw new AppError({
      statusCode: 409,
      code: "DRIVER_SCHEDULE_CONFLICT",
      message:
        "Driver is already assigned to another active schedule at this day and time",
      details: {
        conflictingScheduleId: driverConflict.id,
        driverName: driverConflict.driver.fullName,
        routeName: driverConflict.route.routeName,
      },
    });
  }
}

function toServiceScheduleDto(item: {
  id: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  dayType:
    | "SUNDAY"
    | "MONDAY"
    | "TUESDAY"
    | "WEDNESDAY"
    | "THURSDAY"
    | "FRIDAY"
    | "SATURDAY";
  departureTime: Date;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  route: { id: string; routeName: string };
  bus: { id: string; busCode: string; plateNumber: string | null };
  driver: { id: string; fullName: string; email: string } | null;
  _count?: { trips: number };
}) {
  return {
    id: item.id,
    routeId: item.routeId,
    routeName: item.route.routeName,
    busId: item.busId,
    busCode: item.bus.busCode,
    plateNumber: item.bus.plateNumber,
    driverId: item.driverId,
    driverName: item.driver?.fullName ?? null,
    driverEmail: item.driver?.email ?? null,
    dayType: item.dayType,
    departureTime: formatTime(item.departureTime),
    isActive: item.isActive,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    tripCount: item._count?.trips ?? 0,
  };
}

function buildArchivedNotes(notes: string | null) {
  const archivedPrefix = "[AUTO_ARCHIVED]";
  if (notes && notes.includes(archivedPrefix)) {
    return notes;
  }
  if (notes && notes.trim().length > 0) {
    return `${archivedPrefix} ${notes}`;
  }
  return archivedPrefix;
}

function removeArchivedMarker(notes: string | null) {
  if (!notes) return null;
  const cleaned = notes.replace("[AUTO_ARCHIVED]", "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export async function listServiceSchedulesService(
  query: ListServiceSchedulesQuery,
) {
  const page = query.page;
  const limit = query.limit;
  const skip = (page - 1) * limit;

  const where = buildWhere(query);

  const [total, items] = await prisma.$transaction([
    prisma.serviceSchedule.count({ where }),
    prisma.serviceSchedule.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { isActive: "desc" },
        { dayType: "asc" },
        { departureTime: "asc" },
        { createdAt: "desc" },
      ],
      include: {
        route: { select: { id: true, routeName: true } },
        bus: { select: { id: true, busCode: true, plateNumber: true } },
        driver: { select: { id: true, fullName: true, email: true } },
        _count: { select: { trips: true } },
      },
    }),
  ]);

  return {
    items: items.map(toServiceScheduleDto),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getServiceScheduleByIdService(id: string) {
  const item = await prisma.serviceSchedule.findUnique({
    where: { id },
    include: {
      route: { select: { id: true, routeName: true } },
      bus: { select: { id: true, busCode: true, plateNumber: true } },
      driver: { select: { id: true, fullName: true, email: true } },
      _count: { select: { trips: true } },
    },
  });

  if (!item) {
    throw new AppError({
      statusCode: 404,
      code: "SERVICE_SCHEDULE_NOT_FOUND",
      message: "Service schedule not found",
    });
  }

  return toServiceScheduleDto(item);
}

export async function createServiceScheduleService(
  input: CreateServiceScheduleInput,
) {
  const driverId = input.driverId ?? null;

  await ensureAssignmentEntities({
    routeId: input.routeId,
    busId: input.busId,
    driverId,
  });

  await ensureNoOperationalConflict({
    busId: input.busId,
    driverId,
    dayType: input.dayType,
    departureTime: input.departureTime,
  });

  const item = await prisma.serviceSchedule.create({
    data: {
      routeId: input.routeId,
      busId: input.busId,
      driverId,
      dayType: input.dayType,
      departureTime: parseTimeToDate(input.departureTime),
      isActive: input.isActive ?? true,
      notes: input.notes ?? null,
    },
    include: {
      route: { select: { id: true, routeName: true } },
      bus: { select: { id: true, busCode: true, plateNumber: true } },
      driver: { select: { id: true, fullName: true, email: true } },
      _count: { select: { trips: true } },
    },
  });

  return toServiceScheduleDto(item);
}

export async function updateServiceScheduleService(
  id: string,
  input: UpdateServiceScheduleInput,
) {
  const existing = await prisma.serviceSchedule.findUnique({
    where: { id },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      dayType: true,
      departureTime: true,
      isActive: true,
    },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "SERVICE_SCHEDULE_NOT_FOUND",
      message: "Service schedule not found",
    });
  }

  const nextRouteId = input.routeId ?? existing.routeId;
  const nextBusId = input.busId ?? existing.busId;
  // `driverId === null` in the request means "clear the driver"; `undefined`
  // means "leave it alone". Distinguish the two with `in input` semantics.
  const nextDriverId =
    input.driverId === undefined ? existing.driverId : input.driverId;
  const nextDayType = input.dayType ?? existing.dayType;
  const nextDepartureTime =
    input.departureTime ?? formatTime(existing.departureTime);

  await ensureAssignmentEntities({
    routeId: nextRouteId,
    busId: nextBusId,
    driverId: nextDriverId,
  });

  if ((input.isActive ?? existing.isActive) === true) {
    await ensureNoOperationalConflict({
      excludeId: id,
      busId: nextBusId,
      driverId: nextDriverId,
      dayType: nextDayType,
      departureTime: nextDepartureTime,
    });
  }

  const item = await prisma.serviceSchedule.update({
    where: { id },
    data: {
      ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
      ...(input.busId !== undefined ? { busId: input.busId } : {}),
      ...(input.driverId !== undefined
        ? { driverId: input.driverId ?? null }
        : {}),
      ...(input.dayType !== undefined ? { dayType: input.dayType } : {}),
      ...(input.departureTime !== undefined
        ? { departureTime: parseTimeToDate(input.departureTime) }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: {
      route: { select: { id: true, routeName: true } },
      bus: { select: { id: true, busCode: true, plateNumber: true } },
      driver: { select: { id: true, fullName: true, email: true } },
      _count: { select: { trips: true } },
    },
  });

  return toServiceScheduleDto(item);
}

export async function archiveServiceScheduleService(id: string) {
  const existing = await prisma.serviceSchedule.findUnique({
    where: { id },
    include: {
      route: { select: { id: true, routeName: true } },
      bus: { select: { id: true, busCode: true, plateNumber: true } },
      driver: { select: { id: true, fullName: true, email: true } },
      _count: { select: { trips: true } },
      trips: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "SERVICE_SCHEDULE_NOT_FOUND",
      message: "Service schedule not found",
    });
  }

  const hasRunningTrip = existing.trips.some(
    (trip) => trip.status === "RUNNING",
  );

  if (hasRunningTrip) {
    throw new AppError({
      statusCode: 409,
      code: "SERVICE_SCHEDULE_HAS_RUNNING_TRIP",
      message:
        "Service schedule cannot be archived because a linked trip is currently running",
    });
  }

  if (!existing.isActive) {
    return {
      alreadyArchived: true,
      item: toServiceScheduleDto(existing),
    };
  }

  const updated = await prisma.serviceSchedule.update({
    where: { id },
    data: {
      isActive: false,
      notes: buildArchivedNotes(existing.notes),
    },
    include: {
      route: { select: { id: true, routeName: true } },
      bus: { select: { id: true, busCode: true, plateNumber: true } },
      driver: { select: { id: true, fullName: true, email: true } },
      _count: { select: { trips: true } },
    },
  });

  return {
    alreadyArchived: false,
    item: toServiceScheduleDto(updated),
  };
}

export async function restoreServiceScheduleService(id: string) {
  const existing = await prisma.serviceSchedule.findUnique({
    where: { id },
    select: {
      id: true,
      routeId: true,
      busId: true,
      driverId: true,
      dayType: true,
      departureTime: true,
      isActive: true,
      notes: true,
    },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "SERVICE_SCHEDULE_NOT_FOUND",
      message: "Service schedule not found",
    });
  }

  if (existing.isActive) {
    const current = await prisma.serviceSchedule.findUnique({
      where: { id },
      include: {
        route: { select: { id: true, routeName: true } },
        bus: { select: { id: true, busCode: true, plateNumber: true } },
        driver: { select: { id: true, fullName: true, email: true } },
        _count: { select: { trips: true } },
      },
    });

    return {
      alreadyRestored: true,
      item: current ? toServiceScheduleDto(current) : null,
    };
  }

  await ensureAssignmentEntities({
    routeId: existing.routeId,
    busId: existing.busId,
    driverId: existing.driverId,
  });

  await ensureNoOperationalConflict({
    excludeId: id,
    busId: existing.busId,
    driverId: existing.driverId,
    dayType: existing.dayType,
    departureTime: formatTime(existing.departureTime),
  });

  const restored = await prisma.serviceSchedule.update({
    where: { id },
    data: {
      isActive: true,
      notes: removeArchivedMarker(existing.notes),
    },
    include: {
      route: { select: { id: true, routeName: true } },
      bus: { select: { id: true, busCode: true, plateNumber: true } },
      driver: { select: { id: true, fullName: true, email: true } },
      _count: { select: { trips: true } },
    },
  });

  return {
    alreadyRestored: false,
    item: toServiceScheduleDto(restored),
  };
}

export async function permanentlyDeleteArchivedServiceScheduleService(
  id: string,
) {
  const existing = await prisma.serviceSchedule.findUnique({
    where: { id },
    select: {
      id: true,
      isActive: true,
      _count: { select: { trips: true } },
      trips: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "SERVICE_SCHEDULE_NOT_FOUND",
      message: "Service schedule not found",
    });
  }

  if (existing.isActive) {
    throw new AppError({
      statusCode: 409,
      code: "SERVICE_SCHEDULE_MUST_BE_ARCHIVED_FIRST",
      message:
        "Service schedule must be archived before it can be permanently deleted",
    });
  }

  const hasRunningTrip = existing.trips.some(
    (trip) => trip.status === "RUNNING",
  );

  if (hasRunningTrip) {
    throw new AppError({
      statusCode: 409,
      code: "SERVICE_SCHEDULE_HAS_RUNNING_TRIP",
      message:
        "Service schedule cannot be permanently deleted because a linked trip is currently running",
    });
  }

  await prisma.$transaction(async (tx) => {
    if (existing._count.trips > 0) {
      await tx.trip.updateMany({
        where: {
          serviceScheduleId: id,
        },
        data: {
          serviceScheduleId: null,
        },
      });
    }

    await tx.serviceSchedule.delete({
      where: { id },
    });
  });

  return {
    permanentlyDeleted: true,
    unlinkedTripCount: existing._count.trips,
  };
}

export async function deleteServiceScheduleService(id: string) {
  const existing = await prisma.serviceSchedule.findUnique({
    where: { id },
    include: {
      route: { select: { id: true, routeName: true } },
      bus: { select: { id: true, busCode: true, plateNumber: true } },
      driver: { select: { id: true, fullName: true, email: true } },
      _count: { select: { trips: true } },
      trips: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "SERVICE_SCHEDULE_NOT_FOUND",
      message: "Service schedule not found",
    });
  }

  const hasRunningTrip = existing.trips.some(
    (trip) => trip.status === "RUNNING",
  );

  if (hasRunningTrip) {
    throw new AppError({
      statusCode: 409,
      code: "SERVICE_SCHEDULE_HAS_RUNNING_TRIP",
      message:
        "Service schedule cannot be deleted because a linked trip is currently running",
      details: {
        tripCount: existing._count.trips,
      },
    });
  }

  if (existing._count.trips > 0) {
    const archived = await archiveServiceScheduleService(id);

    return {
      deleted: false,
      archived: true,
      item: archived.item,
    };
  }

  await prisma.serviceSchedule.delete({
    where: { id },
  });

  return {
    deleted: true,
    archived: false,
    item: null,
  };
}
