import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type DeleteResult = {
  label: string;
  count: number;
};

async function deleteWithRetry(
  label: string,
  action: () => Promise<{ count: number }>,
): Promise<DeleteResult> {
  try {
    const result = await action();
    return { label, count: result.count };
  } catch (error) {
    console.warn(`Retrying delete step: ${label}`);
    const result = await action();
    return { label, count: result.count };
  }
}

async function main() {
  console.log("🧹 Clearing operational and demo data...");

  const results: DeleteResult[] = [];

  // Child / dependent records first
  results.push(
    await deleteWithRetry("StopArrival", () => prisma.stopArrival.deleteMany()),
  );

  results.push(
    await deleteWithRetry("LocationLog", () => prisma.locationLog.deleteMany()),
  );

  results.push(
    await deleteWithRetry("TripEvent", () => prisma.tripEvent.deleteMany()),
  );

  results.push(await deleteWithRetry("Trip", () => prisma.trip.deleteMany()));

  results.push(
    await deleteWithRetry("Schedule", () => prisma.schedule.deleteMany()),
  );

  results.push(
    await deleteWithRetry("ServiceSchedule", () =>
      prisma.serviceSchedule.deleteMany(),
    ),
  );

  results.push(
    await deleteWithRetry("RouteGeometry", () =>
      prisma.routeGeometry.deleteMany(),
    ),
  );

  results.push(
    await deleteWithRetry("RouteStop", () => prisma.routeStop.deleteMany()),
  );

  results.push(await deleteWithRetry("Bus", () => prisma.bus.deleteMany()));

  results.push(await deleteWithRetry("Stop", () => prisma.stop.deleteMany()));

  results.push(await deleteWithRetry("Route", () => prisma.route.deleteMany()));

  // Sessions before user cleanup
  results.push(
    await deleteWithRetry("Session", () => prisma.session.deleteMany()),
  );

  // Remove obvious demo users only
  results.push(
    await deleteWithRetry("Demo Users", () =>
      prisma.user.deleteMany({
        where: {
          OR: [
            { email: { endsWith: ".demo" } },
            { email: "admin@npiub.demo" },
            { email: "driver@npiub.demo" },
            { email: "passenger@npiub.demo" },
          ],
        },
      }),
    ),
  );

  console.log("✅ Operational/demo data cleared");
  console.table(
    results.map((item) => ({
      entity: item.label,
      deleted: item.count,
    })),
  );

  console.log(
    "Next: run bootstrap:admin once, then create real users and real transport data.",
  );
}

main()
  .catch((err) => {
    console.error("❌ resetOperationalData failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
