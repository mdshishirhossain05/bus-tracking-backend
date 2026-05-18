import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/appError.js";
import { hashPassword } from "../utils/password.js";
import type {
  ApprovePassengerInput,
  CreateAdminUserInput,
  ListAdminUsersQuery,
  RejectPassengerInput,
  UpdateAdminUserInput,
  UpdateAdminUserRoleInput,
  UpdateAdminUserStatusInput,
  UpdateRegistrationSettingsInput,
} from "../validators/adminUser.validators.js";

type AdminActor = {
  id: string;
  role: string;
};

function buildUserWhere(query: ListAdminUsersQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};

  if (query.role) where.role = query.role;
  if (typeof query.isActive === "boolean") where.isActive = query.isActive;
  if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
  if (query.registrationSource)
    where.registrationSource = query.registrationSource;

  if (query.academicDepartment && query.academicDepartment.length > 0) {
    where.academicDepartment = {
      contains: query.academicDepartment,
      mode: "insensitive",
    };
  }

  if (query.academicBatch && query.academicBatch.length > 0) {
    where.academicBatch = {
      contains: query.academicBatch,
      mode: "insensitive",
    };
  }

  if (query.search && query.search.trim().length > 0) {
    const search = query.search.trim();
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { studentId: { contains: search, mode: "insensitive" } },
    ];
  }

  return where;
}

function getUserDeleteEligibility(params: {
  role: UserRole;
  approvalStatus: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  registrationSource: "ADMIN" | "SELF";
  sessionCount: number;
  drivenTripCount: number;
}) {
  const {
    role,
    approvalStatus,
    registrationSource,
    sessionCount,
    drivenTripCount,
  } = params;

  if (role !== "PASSENGER") {
    return {
      canDelete: false,
      deleteBlockedReason: "Only passenger accounts can be deleted.",
    };
  }

  if (approvalStatus === "APPROVED") {
    return {
      canDelete: false,
      deleteBlockedReason:
        "Approved passenger accounts should be deactivated instead of deleted.",
    };
  }

  if (sessionCount > 0) {
    return {
      canDelete: false,
      deleteBlockedReason:
        "User has session history and cannot be deleted safely.",
    };
  }

  if (drivenTripCount > 0) {
    return {
      canDelete: false,
      deleteBlockedReason:
        "User has trip history and cannot be deleted safely.",
    };
  }

  return {
    canDelete: true,
    deleteBlockedReason:
      registrationSource === "SELF"
        ? "Pending or rejected self-registered passenger can be deleted safely."
        : "Pending or rejected passenger can be deleted safely.",
  };
}

async function ensureUniqueEmail(email: string, exceptUserId?: string) {
  const existing = await prisma.user.findFirst({
    where: {
      email,
      ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw new AppError({
      statusCode: 409,
      code: "EMAIL_ALREADY_EXISTS",
      message: "Email already exists",
    });
  }
}

async function ensureUniqueStudentId(
  studentId?: string | null,
  exceptUserId?: string,
) {
  if (!studentId?.trim()) return;

  const existing = await prisma.user.findFirst({
    where: {
      studentId: studentId.trim(),
      ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw new AppError({
      statusCode: 409,
      code: "STUDENT_ID_ALREADY_EXISTS",
      message: "Student ID already exists",
    });
  }
}

function assertRoleTransitionAllowed(params: {
  actor: AdminActor;
  targetUserId: string;
  currentRole: UserRole;
  nextRole: UserRole;
}) {
  const { actor, targetUserId, currentRole, nextRole } = params;

  if (actor.id === targetUserId && currentRole !== nextRole) {
    throw new AppError({
      statusCode: 400,
      code: "SELF_ROLE_CHANGE_NOT_ALLOWED",
      message: "You cannot change your own role",
    });
  }
}

function assertStatusChangeAllowed(params: {
  actor: AdminActor;
  targetUserId: string;
  nextIsActive: boolean;
}) {
  const { actor, targetUserId, nextIsActive } = params;

  if (actor.id === targetUserId && !nextIsActive) {
    throw new AppError({
      statusCode: 400,
      code: "SELF_DEACTIVATION_NOT_ALLOWED",
      message: "You cannot deactivate your own account",
    });
  }
}

export async function getRegistrationSettingsService() {
  const config = await prisma.appConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      passengerSelfRegistrationEnabled: true,
    },
    update: {},
    select: {
      passengerSelfRegistrationEnabled: true,
      updatedAt: true,
    },
  });

  return config;
}

export async function updateRegistrationSettingsService(
  input: UpdateRegistrationSettingsInput,
) {
  const config = await prisma.appConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      passengerSelfRegistrationEnabled: input.passengerSelfRegistrationEnabled,
    },
    update: {
      passengerSelfRegistrationEnabled: input.passengerSelfRegistrationEnabled,
    },
    select: {
      passengerSelfRegistrationEnabled: true,
      updatedAt: true,
    },
  });

  return config;
}

export async function searchUsersService(query: string) {
  const q = query.trim();

  if (q.length < 2) return [];

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { studentId: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 20,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      studentId: true,
      phoneNumber: true,
      approvalStatus: true,
      registrationSource: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          sessions: true,
          driverTrips: true,
        },
      },
    },
  });

  return users.map((item) => {
    const deleteState = getUserDeleteEligibility({
      role: item.role,
      approvalStatus: item.approvalStatus,
      registrationSource: item.registrationSource,
      sessionCount: item._count.sessions,
      drivenTripCount: item._count.driverTrips,
    });

    return {
      id: item.id,
      fullName: item.fullName,
      email: item.email,
      role: item.role,
      isActive: item.isActive,
      studentId: item.studentId,
      phoneNumber: item.phoneNumber,
      approvalStatus: item.approvalStatus,
      registrationSource: item.registrationSource,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sessionCount: item._count.sessions,
      drivenTripCount: item._count.driverTrips,
      canDelete: deleteState.canDelete,
      deleteBlockedReason: deleteState.deleteBlockedReason,
    };
  });
}

export async function listAdminUsersService(query: ListAdminUsersQuery) {
  const page = query.page;
  const limit = query.limit;
  const skip = (page - 1) * limit;
  const where = buildUserWhere(query);

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        studentId: true,
        phoneNumber: true,
        approvalStatus: true,
        registrationSource: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            sessions: true,
            driverTrips: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: items.map((item) => {
      const deleteState = getUserDeleteEligibility({
        role: item.role,
        approvalStatus: item.approvalStatus,
        registrationSource: item.registrationSource,
        sessionCount: item._count.sessions,
        drivenTripCount: item._count.driverTrips,
      });

      return {
        id: item.id,
        fullName: item.fullName,
        email: item.email,
        role: item.role,
        isActive: item.isActive,
        studentId: item.studentId,
        phoneNumber: item.phoneNumber,
        approvalStatus: item.approvalStatus,
        registrationSource: item.registrationSource,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        sessionCount: item._count.sessions,
        drivenTripCount: item._count.driverTrips,
        canDelete: deleteState.canDelete,
        deleteBlockedReason: deleteState.deleteBlockedReason,
      };
    }),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getAdminUserByIdService(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      studentId: true,
      phoneNumber: true,
      approvalStatus: true,
      registrationSource: true,
      approvedAt: true,
      approvedByUserId: true,
      rejectedAt: true,
      rejectedByUserId: true,
      rejectionReason: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          sessions: true,
          driverTrips: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError({
      statusCode: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  }

  const deleteState = getUserDeleteEligibility({
    role: user.role,
    approvalStatus: user.approvalStatus,
    registrationSource: user.registrationSource,
    sessionCount: user._count.sessions,
    drivenTripCount: user._count.driverTrips,
  });

  return {
    ...user,
    sessionCount: user._count.sessions,
    drivenTripCount: user._count.driverTrips,
    canDelete: deleteState.canDelete,
    deleteBlockedReason: deleteState.deleteBlockedReason,
  };
}

export async function createAdminUserService(input: CreateAdminUserInput) {
  const email = input.email.trim().toLowerCase();
  const studentId = input.studentId?.trim() || null;
  const phoneNumber = input.phoneNumber?.trim() || null;

  await ensureUniqueEmail(email);
  await ensureUniqueStudentId(studentId);

  const passwordHash = await hashPassword(input.password);

  return prisma.user.create({
    data: {
      fullName: input.fullName.trim(),
      email,
      passwordHash,
      role: input.role,
      isActive: input.isActive,
      studentId,
      phoneNumber,
      academicDepartment: input.academicDepartment?.trim() || null,
      academicBatch: input.academicBatch?.trim() || null,
      transportPickupPoint: input.transportPickupPoint?.trim() || null,
      registrationSource: "ADMIN",
      approvalStatus: "APPROVED",
      approvedAt: input.isActive ? new Date() : null,
      approvedByUserId: null,
      rejectedAt: null,
      rejectedByUserId: null,
      rejectionReason: null,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      studentId: true,
      phoneNumber: true,
      approvalStatus: true,
      registrationSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function updateAdminUserService(
  userId: string,
  input: UpdateAdminUserInput,
) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  }

  if (input.email) {
    await ensureUniqueEmail(input.email, userId);
  }

  if (input.studentId !== undefined) {
    await ensureUniqueStudentId(input.studentId, userId);
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.fullName !== undefined
        ? { fullName: input.fullName.trim() }
        : {}),
      ...(input.email !== undefined
        ? { email: input.email.trim().toLowerCase() }
        : {}),
      ...(input.studentId !== undefined
        ? { studentId: input.studentId?.trim() || null }
        : {}),
      ...(input.phoneNumber !== undefined
        ? { phoneNumber: input.phoneNumber?.trim() || null }
        : {}),
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      studentId: true,
      phoneNumber: true,
      approvalStatus: true,
      registrationSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function updateAdminUserRoleService(
  actor: AdminActor,
  userId: string,
  input: UpdateAdminUserRoleInput,
) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  }

  assertRoleTransitionAllowed({
    actor,
    targetUserId: userId,
    currentRole: existing.role,
    nextRole: input.role,
  });

  return prisma.user.update({
    where: { id: userId },
    data: { role: input.role },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      studentId: true,
      phoneNumber: true,
      approvalStatus: true,
      registrationSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function updateAdminUserStatusService(
  actor: AdminActor,
  userId: string,
  input: UpdateAdminUserStatusInput,
) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  }

  assertStatusChangeAllowed({
    actor,
    targetUserId: userId,
    nextIsActive: input.isActive,
  });

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { isActive: input.isActive },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        studentId: true,
        phoneNumber: true,
        approvalStatus: true,
        registrationSource: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!input.isActive) {
      await tx.session.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revokedReason: "USER_DEACTIVATED_BY_ADMIN",
          isCurrent: false,
        },
      });
    }

    return user;
  });
}

export async function approvePassengerService(
  actor: AdminActor,
  userId: string,
  _input: ApprovePassengerInput,
) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
    },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  }

  if (existing.role !== "PASSENGER") {
    throw new AppError({
      statusCode: 400,
      code: "USER_IS_NOT_PASSENGER",
      message: "Only passenger accounts can be approved",
    });
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      approvalStatus: "APPROVED",
      isActive: true,
      approvedAt: new Date(),
      approvedByUserId: actor.id,
      rejectedAt: null,
      rejectedByUserId: null,
      rejectionReason: null,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      studentId: true,
      phoneNumber: true,
      approvalStatus: true,
      registrationSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function rejectPassengerService(
  actor: AdminActor,
  userId: string,
  input: RejectPassengerInput,
) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
    },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  }

  if (existing.role !== "PASSENGER") {
    throw new AppError({
      statusCode: 400,
      code: "USER_IS_NOT_PASSENGER",
      message: "Only passenger accounts can be rejected",
    });
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        approvalStatus: "REJECTED",
        isActive: false,
        approvedAt: null,
        approvedByUserId: null,
        rejectedAt: new Date(),
        rejectedByUserId: actor.id,
        rejectionReason: input.reason.trim(),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        studentId: true,
        phoneNumber: true,
        approvalStatus: true,
        registrationSource: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedReason: "PASSENGER_REJECTED_BY_ADMIN",
        isCurrent: false,
      },
    });

    return user;
  });
}

export async function deleteUserService(actor: AdminActor, userId: string) {
  if (actor.id === userId) {
    throw new AppError({
      statusCode: 400,
      code: "SELF_DELETE_NOT_ALLOWED",
      message: "You cannot delete your own account",
    });
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      approvalStatus: true,
      registrationSource: true,
      _count: {
        select: {
          sessions: true,
          driverTrips: true,
        },
      },
    },
  });

  if (!existing) {
    throw new AppError({
      statusCode: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  }

  const eligibility = getUserDeleteEligibility({
    role: existing.role,
    approvalStatus: existing.approvalStatus,
    registrationSource: existing.registrationSource,
    sessionCount: existing._count.sessions,
    drivenTripCount: existing._count.driverTrips,
  });

  if (!eligibility.canDelete) {
    throw new AppError({
      statusCode: 400,
      code: "USER_DELETE_NOT_ALLOWED",
      message: eligibility.deleteBlockedReason,
    });
  }

  await prisma.user.delete({
    where: { id: userId },
  });

  return {
    id: userId,
    deleted: true,
  };
}

export async function listSessionsByUserId(userId: string) {
  return prisma.session.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      lastSeenAt: true,
      ipFirst: true,
      ipLast: true,
      lastSeenIp: true,
      deviceLabel: true,
      userAgentRaw: true,
      refreshFamilyId: true,
      isCurrent: true,
      revokedAt: true,
      revokedReason: true,
      roleSnapshot: true,
    },
  });
}
