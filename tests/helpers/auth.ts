import { prisma } from "../../src/config/prisma.js";

export async function deleteUserByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  await prisma.emailVerificationOtp.deleteMany({
    where: {
      email: normalizedEmail,
    },
  });

  await prisma.user.deleteMany({
    where: {
      email: normalizedEmail,
    },
  });
}

export async function enablePassengerSelfRegistrationForTests() {
  await prisma.appConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      passengerSelfRegistrationEnabled: true,
    },
    update: {
      passengerSelfRegistrationEnabled: true,
    },
  });
}
