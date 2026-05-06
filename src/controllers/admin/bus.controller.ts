import { createHash, randomBytes } from "node:crypto";
import { Request, Response } from "express";
import { Prisma, TraccarSyncStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import {
  createBusSchema,
  updateBusSchema,
} from "../../validators/bus.validators.js";
import { uuidParamSchema } from "../../validators/params.validators.js";
import { cleanUndefined } from "../../utils/clean.js";
import {
  getTraccarBaseUrl,
  getTraccarDeviceStatus,
  isTraccarConfigured,
  reconcileTraccarDevice,
} from "../../services/traccar.service.js";

function handlePrismaConflict(error: unknown, entity: "bus" | "gps_device") {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return {
      status: 409,
      body: {
        message:
          entity === "bus"
            ? "Bus code or plate number already exists"
            : "Device code, serial number, IMEI, or Traccar linkage already exists",
      },
    };
  }

  return null;
}

function trimOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseBusId(req: Request) {
  const parsed = uuidParamSchema.safeParse(req.params.id);
  if (!parsed.success) return null;
  return parsed.data;
}

function parseGpsDeviceId(req: Request) {
  const parsed = uuidParamSchema.safeParse(req.params.id);
  if (!parsed.success) return null;
  return parsed.data;
}

function hashApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

function parseOptionalInteger(value: unknown) {
  if (value == null || value === "") return null;

  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isFinite(num) ? num : null;
}

function normalizeTraccarSyncStatus(
  value: unknown,
): TraccarSyncStatus | undefined {
  return value === "UNLINKED" ||
    value === "LINKED" ||
    value === "SYNCED" ||
    value === "ERROR"
    ? (value as TraccarSyncStatus)
    : undefined;
}

function sanitizeGpsDevice(device: {
  id: string;
  deviceCode: string;
  serialNumber: string | null;
  displayName: string | null;
  vendorName: string | null;
  modelName: string | null;
  imei: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
  lastRecordedAt: Date | null;
  lastIp: string | null;
  lastStatus: "HEALTHY" | "STALE" | "UNHEALTHY" | "DISCONNECTED" | null;
  lastLat: Prisma.Decimal | null;
  lastLng: Prisma.Decimal | null;
  lastSpeedKmh: Prisma.Decimal | null;
  lastHeading: number | null;
  lastAccuracyM: Prisma.Decimal | null;
  traccarManaged: boolean;
  traccarDeviceId: number | null;
  traccarUniqueId: string | null;
  traccarServerBaseUrl: string | null;
  traccarSyncStatus: "UNLINKED" | "LINKED" | "SYNCED" | "ERROR";
  traccarLastSyncAt: Date | null;
  traccarLastError: string | null;
}) {
  return {
    id: device.id,
    deviceCode: device.deviceCode,
    serialNumber: device.serialNumber,
    displayName: device.displayName,
    vendorName: device.vendorName,
    modelName: device.modelName,
    imei: device.imei,
    isActive: device.isActive,
    notes: device.notes,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    lastSeenAt: device.lastSeenAt,
    lastRecordedAt: device.lastRecordedAt,
    lastIp: device.lastIp,
    lastStatus: device.lastStatus,
    lastLat: device.lastLat != null ? Number(device.lastLat) : null,
    lastLng: device.lastLng != null ? Number(device.lastLng) : null,
    lastSpeedKmh:
      device.lastSpeedKmh != null ? Number(device.lastSpeedKmh) : null,
    lastHeading: device.lastHeading,
    lastAccuracyM:
      device.lastAccuracyM != null ? Number(device.lastAccuracyM) : null,
    traccarManaged: device.traccarManaged,
    traccarDeviceId: device.traccarDeviceId,
    traccarUniqueId: device.traccarUniqueId,
    traccarServerBaseUrl: device.traccarServerBaseUrl,
    traccarSyncStatus: device.traccarSyncStatus,
    traccarLastSyncAt: device.traccarLastSyncAt,
    traccarLastError: device.traccarLastError,
  };
}

async function syncGpsDeviceToTraccarBestEffort(gpsDeviceId: string) {
  const device = await prisma.gpsDevice.findUnique({
    where: { id: gpsDeviceId },
  });

  if (!device) return null;
  if (!device.traccarManaged) return sanitizeGpsDevice(device);

  if (!isTraccarConfigured()) {
    const updated = await prisma.gpsDevice.update({
      where: { id: gpsDeviceId },
      data: {
        traccarSyncStatus: TraccarSyncStatus.LINKED,
        traccarLastSyncAt: null,
        traccarLastError: null,
        traccarServerBaseUrl:
          device.traccarServerBaseUrl ?? getTraccarBaseUrl(),
      },
    });

    return sanitizeGpsDevice(updated);
  }

  try {
    const result = await reconcileTraccarDevice({
      id: device.id,
      deviceCode: device.deviceCode,
      displayName: device.displayName,
      serialNumber: device.serialNumber,
      vendorName: device.vendorName,
      modelName: device.modelName,
      imei: device.imei,
      isActive: device.isActive,
      traccarDeviceId: device.traccarDeviceId,
      traccarUniqueId: device.traccarUniqueId,
      traccarServerBaseUrl: device.traccarServerBaseUrl,
    });

    const updated = await prisma.gpsDevice.update({
      where: { id: gpsDeviceId },
      data: {
        traccarDeviceId: result.remoteDevice.id,
        traccarUniqueId: result.resolvedUniqueId,
        traccarServerBaseUrl: result.resolvedServerBaseUrl,
        traccarSyncStatus: TraccarSyncStatus.SYNCED,
        traccarLastSyncAt: new Date(),
        traccarLastError: null,
      },
    });

    return sanitizeGpsDevice(updated);
  } catch (error: any) {
    const updated = await prisma.gpsDevice.update({
      where: { id: gpsDeviceId },
      data: {
        traccarSyncStatus: TraccarSyncStatus.ERROR,
        traccarLastSyncAt: new Date(),
        traccarLastError:
          error?.message ?? "Failed to reconcile device with Traccar",
      },
    });

    return sanitizeGpsDevice(updated);
  }
}

export async function createBus(req: Request, res: Response) {
  const parsed = createBusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid data",
      errors: parsed.error.format(),
    });
  }

  const data = cleanUndefined(parsed.data);

  try {
    const bus = await prisma.bus.create({ data });
    return res.status(201).json({ bus });
  } catch (error) {
    const conflict = handlePrismaConflict(error, "bus");
    if (conflict) {
      return res.status(conflict.status).json(conflict.body);
    }
    throw error;
  }
}

export async function listBuses(_req: Request, res: Response) {
  const buses = await prisma.bus.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      gpsAssignments: {
        where: {
          isActive: true,
          unassignedAt: null,
        },
        take: 1,
        orderBy: {
          assignedAt: "desc",
        },
        include: {
          gpsDevice: true,
        },
      },
    },
  });

  return res.json({
    buses: buses.map((bus) => ({
      ...bus,
      activeGpsDeviceAssignment:
        bus.gpsAssignments.length > 0
          ? {
              id: bus.gpsAssignments[0]!.id,
              assignedAt: bus.gpsAssignments[0]!.assignedAt,
              notes: bus.gpsAssignments[0]!.notes,
              gpsDevice: sanitizeGpsDevice(bus.gpsAssignments[0]!.gpsDevice),
            }
          : null,
    })),
  });
}

export async function updateBus(req: Request, res: Response) {
  const idParsed = uuidParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const parsed = updateBusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid data",
      errors: parsed.error.format(),
    });
  }

  const data = cleanUndefined(parsed.data);

  try {
    const bus = await prisma.bus.update({
      where: { id: idParsed.data },
      data,
    });

    return res.json({ bus });
  } catch (error) {
    const conflict = handlePrismaConflict(error, "bus");
    if (conflict) {
      return res.status(conflict.status).json(conflict.body);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.status(404).json({ message: "Bus not found" });
    }

    throw error;
  }
}

export async function deleteBus(req: Request, res: Response) {
  const idParsed = uuidParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const id = idParsed.data;

  const dependencies = await prisma.bus.findUnique({
    where: { id },
    select: {
      _count: {
        select: {
          trips: true,
          tripEvents: true,
          serviceSchedules: true,
          gpsAssignments: true,
          canonicalStates: true,
          sourceStates: true,
        },
      },
    },
  });

  if (!dependencies) {
    return res.status(404).json({ message: "Bus not found" });
  }

  const {
    trips,
    tripEvents,
    serviceSchedules,
    gpsAssignments,
    canonicalStates,
    sourceStates,
  } = dependencies._count;

  if (
    trips > 0 ||
    tripEvents > 0 ||
    serviceSchedules > 0 ||
    gpsAssignments > 0 ||
    canonicalStates > 0 ||
    sourceStates > 0
  ) {
    return res.status(409).json({
      message: "Bus cannot be deleted because it is in use",
      dependencies: {
        trips,
        tripEvents,
        serviceSchedules,
        gpsAssignments,
        canonicalStates,
        sourceStates,
      },
    });
  }

  await prisma.bus.delete({ where: { id } });

  return res.json({ message: "Bus deleted successfully" });
}

export async function createGpsDevice(req: Request, res: Response) {
  const deviceCode = trimOrNull(req.body?.deviceCode);
  if (!deviceCode) {
    return res.status(400).json({
      message: "deviceCode is required",
    });
  }

  const incomingApiKey = trimOrNull(req.body?.apiKey);
  const generatedApiKey = incomingApiKey ?? randomBytes(24).toString("hex");
  const apiKeyHash = hashApiKey(generatedApiKey);

  const traccarManaged = Boolean(req.body?.traccarManaged);
  const traccarDeviceId = parseOptionalInteger(req.body?.traccarDeviceId);
  const traccarUniqueId = trimOrNull(req.body?.traccarUniqueId);
  const traccarServerBaseUrl = trimOrNull(req.body?.traccarServerBaseUrl);

  const data: Prisma.GpsDeviceCreateInput = cleanUndefined({
    deviceCode,
    serialNumber: trimOrNull(req.body?.serialNumber),
    displayName: trimOrNull(req.body?.displayName),
    vendorName: trimOrNull(req.body?.vendorName),
    modelName: trimOrNull(req.body?.modelName),
    imei: trimOrNull(req.body?.imei),
    notes: trimOrNull(req.body?.notes),
    isActive:
      typeof req.body?.isActive === "boolean" ? req.body.isActive : true,
    apiKeyHash,
    traccarManaged,
    traccarDeviceId,
    traccarUniqueId,
    traccarServerBaseUrl,
    traccarSyncStatus: traccarManaged
      ? TraccarSyncStatus.LINKED
      : TraccarSyncStatus.UNLINKED,
  });

  try {
    const device = await prisma.gpsDevice.create({ data });
    const syncedDevice = await syncGpsDeviceToTraccarBestEffort(device.id);

    return res.status(201).json({
      gpsDevice: syncedDevice ?? sanitizeGpsDevice(device),
      generatedApiKey,
      message:
        incomingApiKey == null
          ? "GPS device created successfully. Save the generated API key now; it will not be shown again."
          : "GPS device created successfully",
    });
  } catch (error) {
    const conflict = handlePrismaConflict(error, "gps_device");
    if (conflict) {
      return res.status(conflict.status).json(conflict.body);
    }
    throw error;
  }
}

export async function listGpsDevices(_req: Request, res: Response) {
  const devices = await prisma.gpsDevice.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      assignments: {
        where: {
          isActive: true,
          unassignedAt: null,
        },
        take: 1,
        orderBy: {
          assignedAt: "desc",
        },
        include: {
          bus: {
            select: {
              id: true,
              busCode: true,
              plateNumber: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  return res.json({
    gpsDevices: devices.map((device) => ({
      ...sanitizeGpsDevice(device),
      activeAssignment:
        device.assignments.length > 0
          ? {
              id: device.assignments[0]!.id,
              assignedAt: device.assignments[0]!.assignedAt,
              notes: device.assignments[0]!.notes,
              bus: device.assignments[0]!.bus,
            }
          : null,
    })),
  });
}

export async function updateGpsDevice(req: Request, res: Response) {
  const gpsDeviceId = parseGpsDeviceId(req);
  if (!gpsDeviceId) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const shouldRotateApiKey =
    typeof req.body?.rotateApiKey === "boolean" && req.body.rotateApiKey;

  const nextApiKey = shouldRotateApiKey
    ? randomBytes(24).toString("hex")
    : null;

  const data: Prisma.GpsDeviceUpdateInput = cleanUndefined({
    deviceCode: trimOrNull(req.body?.deviceCode) ?? undefined,
    serialNumber: Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "serialNumber",
    )
      ? trimOrNull(req.body?.serialNumber)
      : undefined,
    displayName: Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "displayName",
    )
      ? trimOrNull(req.body?.displayName)
      : undefined,
    vendorName: Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "vendorName",
    )
      ? trimOrNull(req.body?.vendorName)
      : undefined,
    modelName: Object.prototype.hasOwnProperty.call(req.body ?? {}, "modelName")
      ? trimOrNull(req.body?.modelName)
      : undefined,
    imei: Object.prototype.hasOwnProperty.call(req.body ?? {}, "imei")
      ? trimOrNull(req.body?.imei)
      : undefined,
    notes: Object.prototype.hasOwnProperty.call(req.body ?? {}, "notes")
      ? trimOrNull(req.body?.notes)
      : undefined,
    isActive:
      typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
    apiKeyHash: nextApiKey ? hashApiKey(nextApiKey) : undefined,
    traccarManaged:
      typeof req.body?.traccarManaged === "boolean"
        ? req.body.traccarManaged
        : undefined,
    traccarDeviceId: Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "traccarDeviceId",
    )
      ? parseOptionalInteger(req.body?.traccarDeviceId)
      : undefined,
    traccarUniqueId: Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "traccarUniqueId",
    )
      ? trimOrNull(req.body?.traccarUniqueId)
      : undefined,
    traccarServerBaseUrl: Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "traccarServerBaseUrl",
    )
      ? trimOrNull(req.body?.traccarServerBaseUrl)
      : undefined,
    traccarSyncStatus:
      typeof req.body?.traccarManaged === "boolean" && req.body.traccarManaged
        ? (normalizeTraccarSyncStatus(req.body?.traccarSyncStatus) ??
          TraccarSyncStatus.LINKED)
        : typeof req.body?.traccarManaged === "boolean" &&
            !req.body.traccarManaged
          ? TraccarSyncStatus.UNLINKED
          : normalizeTraccarSyncStatus(req.body?.traccarSyncStatus),
    traccarLastError:
      typeof req.body?.traccarManaged === "boolean" && !req.body.traccarManaged
        ? null
        : undefined,
  });

  try {
    const device = await prisma.gpsDevice.update({
      where: { id: gpsDeviceId },
      data,
    });

    const syncedDevice = await syncGpsDeviceToTraccarBestEffort(device.id);

    return res.json({
      gpsDevice: syncedDevice ?? sanitizeGpsDevice(device),
      generatedApiKey: nextApiKey,
      message: "GPS device updated successfully",
    });
  } catch (error) {
    const conflict = handlePrismaConflict(error, "gps_device");
    if (conflict) {
      return res.status(conflict.status).json(conflict.body);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.status(404).json({ message: "GPS device not found" });
    }

    throw error;
  }
}

export async function getGpsDeviceTraccarStatus(req: Request, res: Response) {
  const gpsDeviceId = parseGpsDeviceId(req);
  if (!gpsDeviceId) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const device = await prisma.gpsDevice.findUnique({
    where: { id: gpsDeviceId },
  });

  if (!device) {
    return res.status(404).json({ message: "GPS device not found" });
  }

  if (!device.traccarManaged) {
    return res.json({
      gpsDevice: sanitizeGpsDevice(device),
      traccarConfigured: isTraccarConfigured(),
      remoteDevice: null,
      message: "This GPS device is not managed by Traccar",
    });
  }

  if (!isTraccarConfigured()) {
    return res.status(503).json({
      gpsDevice: sanitizeGpsDevice(device),
      traccarConfigured: false,
      remoteDevice: null,
      message:
        "Traccar integration is not configured on the backend. Set TRACCAR_BASE_URL and credentials first.",
    });
  }

  try {
    const result = await getTraccarDeviceStatus({
      id: device.id,
      deviceCode: device.deviceCode,
      displayName: device.displayName,
      serialNumber: device.serialNumber,
      vendorName: device.vendorName,
      modelName: device.modelName,
      imei: device.imei,
      isActive: device.isActive,
      traccarDeviceId: device.traccarDeviceId,
      traccarUniqueId: device.traccarUniqueId,
      traccarServerBaseUrl: device.traccarServerBaseUrl,
    });

    return res.json({
      gpsDevice: sanitizeGpsDevice(device),
      traccarConfigured: true,
      remoteDevice: result.remoteDevice,
      resolvedUniqueId: result.resolvedUniqueId,
      resolvedServerBaseUrl: result.resolvedServerBaseUrl,
    });
  } catch (error: any) {
    return res.status(502).json({
      gpsDevice: sanitizeGpsDevice(device),
      traccarConfigured: true,
      remoteDevice: null,
      message: error?.message ?? "Failed to fetch Traccar device status",
    });
  }
}

export async function reconcileGpsDeviceWithTraccar(
  req: Request,
  res: Response,
) {
  const gpsDeviceId = parseGpsDeviceId(req);
  if (!gpsDeviceId) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const device = await prisma.gpsDevice.findUnique({
    where: { id: gpsDeviceId },
  });

  if (!device) {
    return res.status(404).json({ message: "GPS device not found" });
  }

  if (!device.traccarManaged) {
    return res.status(409).json({
      message:
        "This GPS device is not marked as Traccar-managed. Enable Traccar integration first.",
    });
  }

  if (!isTraccarConfigured()) {
    return res.status(503).json({
      message:
        "Traccar integration is not configured on the backend. Set TRACCAR_BASE_URL and credentials first.",
    });
  }

  try {
    const result = await reconcileTraccarDevice({
      id: device.id,
      deviceCode: device.deviceCode,
      displayName: device.displayName,
      serialNumber: device.serialNumber,
      vendorName: device.vendorName,
      modelName: device.modelName,
      imei: device.imei,
      isActive: device.isActive,
      traccarDeviceId: device.traccarDeviceId,
      traccarUniqueId: device.traccarUniqueId,
      traccarServerBaseUrl: device.traccarServerBaseUrl,
    });

    const updated = await prisma.gpsDevice.update({
      where: { id: gpsDeviceId },
      data: {
        traccarDeviceId: result.remoteDevice.id,
        traccarUniqueId: result.resolvedUniqueId,
        traccarServerBaseUrl: result.resolvedServerBaseUrl,
        traccarSyncStatus: TraccarSyncStatus.SYNCED,
        traccarLastSyncAt: new Date(),
        traccarLastError: null,
      },
    });

    return res.json({
      message: "GPS device reconciled with Traccar successfully",
      gpsDevice: sanitizeGpsDevice(updated),
      remoteDevice: result.remoteDevice,
    });
  } catch (error: any) {
    const updated = await prisma.gpsDevice.update({
      where: { id: gpsDeviceId },
      data: {
        traccarSyncStatus: TraccarSyncStatus.ERROR,
        traccarLastSyncAt: new Date(),
        traccarLastError:
          error?.message ?? "Failed to reconcile Traccar device",
      },
    });

    return res.status(502).json({
      message: error?.message ?? "Failed to reconcile Traccar device",
      gpsDevice: sanitizeGpsDevice(updated),
      remoteDevice: null,
    });
  }
}

export async function deleteGpsDevice(req: Request, res: Response) {
  const gpsDeviceId = parseGpsDeviceId(req);
  if (!gpsDeviceId) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const dependencies = await prisma.gpsDevice.findUnique({
    where: { id: gpsDeviceId },
    select: {
      _count: {
        select: {
          assignments: true,
          sourceStates: true,
          ingestLogs: true,
          autoStartedTrips: true,
        },
      },
    },
  });

  if (!dependencies) {
    return res.status(404).json({ message: "GPS device not found" });
  }

  const { assignments, sourceStates, ingestLogs, autoStartedTrips } =
    dependencies._count;

  if (
    assignments > 0 ||
    sourceStates > 0 ||
    ingestLogs > 0 ||
    autoStartedTrips > 0
  ) {
    return res.status(409).json({
      message: "GPS device cannot be deleted because it is in use",
      dependencies: {
        assignments,
        sourceStates,
        ingestLogs,
        autoStartedTrips,
      },
    });
  }

  await prisma.gpsDevice.delete({
    where: { id: gpsDeviceId },
  });

  return res.json({ message: "GPS device deleted successfully" });
}

export async function getBusGpsDeviceAssignment(req: Request, res: Response) {
  const busId = parseBusId(req);
  if (!busId) {
    return res.status(400).json({ message: "Invalid bus id" });
  }

  const bus = await prisma.bus.findUnique({
    where: { id: busId },
    select: {
      id: true,
      busCode: true,
      plateNumber: true,
      isActive: true,
    },
  });

  if (!bus) {
    return res.status(404).json({ message: "Bus not found" });
  }

  const assignment = await prisma.busGpsDeviceAssignment.findFirst({
    where: {
      busId,
      isActive: true,
      unassignedAt: null,
    },
    orderBy: {
      assignedAt: "desc",
    },
    include: {
      gpsDevice: true,
    },
  });

  return res.json({
    bus,
    assignment: assignment
      ? {
          id: assignment.id,
          assignedAt: assignment.assignedAt,
          notes: assignment.notes,
          gpsDevice: sanitizeGpsDevice(assignment.gpsDevice),
        }
      : null,
  });
}

export async function assignGpsDeviceToBus(req: Request, res: Response) {
  const busId = parseBusId(req);
  if (!busId) {
    return res.status(400).json({ message: "Invalid bus id" });
  }

  const gpsDeviceId = trimOrNull(req.body?.gpsDeviceId);
  if (!gpsDeviceId) {
    return res.status(400).json({ message: "gpsDeviceId is required" });
  }

  const gpsDeviceIdParsed = uuidParamSchema.safeParse(gpsDeviceId);
  if (!gpsDeviceIdParsed.success) {
    return res.status(400).json({ message: "Invalid gpsDeviceId" });
  }

  const notes = trimOrNull(req.body?.notes);

  const [bus, gpsDevice] = await Promise.all([
    prisma.bus.findUnique({
      where: { id: busId },
      select: {
        id: true,
        busCode: true,
        plateNumber: true,
        isActive: true,
      },
    }),
    prisma.gpsDevice.findUnique({
      where: { id: gpsDeviceIdParsed.data },
    }),
  ]);

  if (!bus) {
    return res.status(404).json({ message: "Bus not found" });
  }

  if (!gpsDevice) {
    return res.status(404).json({ message: "GPS device not found" });
  }

  if (!gpsDevice.isActive) {
    return res.status(409).json({
      message: "Inactive GPS device cannot be assigned",
    });
  }

  const activeAssignmentForDevice =
    await prisma.busGpsDeviceAssignment.findFirst({
      where: {
        gpsDeviceId: gpsDevice.id,
        isActive: true,
        unassignedAt: null,
      },
      include: {
        bus: {
          select: {
            id: true,
            busCode: true,
            plateNumber: true,
          },
        },
      },
    });

  if (activeAssignmentForDevice && activeAssignmentForDevice.busId !== busId) {
    return res.status(409).json({
      message: "GPS device is already assigned to another bus",
      activeAssignment: {
        id: activeAssignmentForDevice.id,
        bus: activeAssignmentForDevice.bus,
        assignedAt: activeAssignmentForDevice.assignedAt,
      },
    });
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const currentBusAssignment = await tx.busGpsDeviceAssignment.findFirst({
      where: {
        busId,
        isActive: true,
        unassignedAt: null,
      },
      orderBy: {
        assignedAt: "desc",
      },
      include: {
        gpsDevice: true,
      },
    });

    if (
      currentBusAssignment &&
      currentBusAssignment.gpsDeviceId === gpsDevice.id
    ) {
      const updated = await tx.busGpsDeviceAssignment.update({
        where: { id: currentBusAssignment.id },
        data: { notes: notes ?? currentBusAssignment.notes },
        include: {
          gpsDevice: true,
        },
      });

      return {
        reused: true,
        assignment: updated,
      };
    }

    if (currentBusAssignment) {
      await tx.busGpsDeviceAssignment.update({
        where: { id: currentBusAssignment.id },
        data: {
          isActive: false,
          unassignedAt: now,
        },
      });
    }

    const assignment = await tx.busGpsDeviceAssignment.create({
      data: {
        busId,
        gpsDeviceId: gpsDevice.id,
        assignedAt: now,
        isActive: true,
        notes,
      },
      include: {
        gpsDevice: true,
      },
    });

    return {
      reused: false,
      assignment,
    };
  });

  return res.json({
    message: result.reused
      ? "GPS device already assigned to this bus"
      : "GPS device assigned successfully",
    bus,
    assignment: {
      id: result.assignment.id,
      assignedAt: result.assignment.assignedAt,
      notes: result.assignment.notes,
      gpsDevice: sanitizeGpsDevice(result.assignment.gpsDevice),
    },
  });
}

export async function unassignGpsDeviceFromBus(req: Request, res: Response) {
  const busId = parseBusId(req);
  if (!busId) {
    return res.status(400).json({ message: "Invalid bus id" });
  }

  const bus = await prisma.bus.findUnique({
    where: { id: busId },
    select: {
      id: true,
      busCode: true,
      plateNumber: true,
      isActive: true,
    },
  });

  if (!bus) {
    return res.status(404).json({ message: "Bus not found" });
  }

  const currentAssignment = await prisma.busGpsDeviceAssignment.findFirst({
    where: {
      busId,
      isActive: true,
      unassignedAt: null,
    },
    orderBy: {
      assignedAt: "desc",
    },
    include: {
      gpsDevice: true,
    },
  });

  if (!currentAssignment) {
    return res.status(404).json({
      message: "No active GPS device assignment found for this bus",
    });
  }

  const unassignedAt = new Date();

  const updated = await prisma.busGpsDeviceAssignment.update({
    where: { id: currentAssignment.id },
    data: {
      isActive: false,
      unassignedAt,
    },
    include: {
      gpsDevice: true,
    },
  });

  return res.json({
    message: "GPS device unassigned successfully",
    bus,
    assignment: {
      id: updated.id,
      assignedAt: updated.assignedAt,
      unassignedAt: updated.unassignedAt,
      notes: updated.notes,
      gpsDevice: sanitizeGpsDevice(updated.gpsDevice),
    },
  });
}
