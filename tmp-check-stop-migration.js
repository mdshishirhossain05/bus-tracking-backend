const { Client } = require("pg");

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  const queries = [
    {
      title: "Schedule dayType values",
      sql: 'SELECT "dayType", COUNT(*)::int AS count FROM "Schedule" GROUP BY "dayType" ORDER BY "dayType"',
    },
    {
      title: "ServiceSchedule dayType values",
      sql: 'SELECT "dayType", COUNT(*)::int AS count FROM "ServiceSchedule" GROUP BY "dayType" ORDER BY "dayType"',
    },
    {
      title: "Duplicate stopCode values",
      sql: 'SELECT "stopCode", COUNT(*)::int AS count FROM "Stop" WHERE "stopCode" IS NOT NULL GROUP BY "stopCode" HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC, "stopCode" ASC',
    },
    {
      title: "Existing non-null stopCode values",
      sql: 'SELECT id, "stopName", "stopCode" FROM "Stop" WHERE "stopCode" IS NOT NULL ORDER BY "stopCode" ASC, "stopName" ASC',
    },
  ];

  for (const item of queries) {
    console.log("\n=== " + item.title + " ===");
    const result = await client.query(item.sql);
    console.table(result.rows);
  }

  await client.end();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
