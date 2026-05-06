import "dotenv/config";
import { prisma } from "../config/prisma.js";
import { hashPassword } from "../utils/password.js";

async function main() {
  const fullName = "System Admin";
  const email = "admin@bus.local";
  const password = "Admin@12345"; // you can change later

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log("Admin already exists:", email);
    return;
  }

  const passwordHash = await hashPassword(password);

  const admin = await prisma.user.create({
    data: {
      fullName,
      email,
      passwordHash,
      role: "ADMIN",
      isActive: true,
    },
    select: { id: true, email: true, role: true },
  });

  console.log("Admin created:", admin);
  console.log("Login with:");
  console.log("email:", email);
  console.log("password:", password);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
