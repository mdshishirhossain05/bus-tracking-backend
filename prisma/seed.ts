import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../src/config/env.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seed started");
  console.log(
    "No demo users, buses, routes, stops, or schedules are seeded in this project.",
  );
  console.log(
    "Use 'npm run bootstrap:admin' once for the first real admin, then create real drivers, passengers, buses, routes, stops, and schedules from admin operations.",
  );
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
