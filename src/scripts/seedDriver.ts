import "dotenv/config";
import { prisma } from "../config/prisma.js";
import { hashPassword } from "../utils/password.js";

async function main() {
  const email = "driver@bus.local";
  const password = "Driver@12345";
  const fullName = "Test Driver";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Driver already exists:", email);
    return;
  }

  const passwordHash = await hashPassword(password);

  const driver = await prisma.user.create({
    data: { fullName, email, passwordHash, role: "DRIVER", isActive: true },
    select: { id: true, email: true, role: true },
  });

  console.log("Driver created:", driver);
  console.log("Login with:", email, password);
}

main().finally(async () => prisma.$disconnect());
