import { prisma } from "../../src/config/prisma.js";

export async function deleteUserByEmail(email: string) {
  await prisma.user.deleteMany({
    where: { email },
  });
}
