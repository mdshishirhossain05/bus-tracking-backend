import { config } from "dotenv";
import path from "path";
import { afterAll } from "vitest";
import { prisma } from "../../src/config/prisma.js";
config({
  path: path.resolve(process.cwd(), ".env.test"),
});
/**
 * Important:
 * Do NOT auto-connect Redis here.
 *
 * Reason:
 * - Some test environments may not have Redis running
 * - Your health tests already tolerate 503
 * - Forcing Redis connection in global setup causes hook timeouts
 */
afterAll(async () => {
  await prisma.$disconnect();
});
//# sourceMappingURL=env.setup.js.map
