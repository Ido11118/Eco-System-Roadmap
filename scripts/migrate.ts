import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db";
(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ migrations applied");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
