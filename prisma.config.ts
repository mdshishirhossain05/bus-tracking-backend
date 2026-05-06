import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

const explicitEnvPath = process.env.DOTENV_CONFIG_PATH?.trim();
const envPath =
  explicitEnvPath && explicitEnvPath.length > 0
    ? explicitEnvPath
    : process.env.NODE_ENV === "test"
      ? ".env.test"
      : ".env";

loadEnv({ path: envPath });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(`DATABASE_URL is missing. Check ${envPath} in project root.`);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url,
  },
  migrations: {
    path: "prisma/migrations",
  },
});
