import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db";

// בעלייה (למשל התעוררות ממצב שינה) בסיס הנתונים או הרשת הפנימית עשויים להיות מוכנים רק אחרי כמה שניות —
// ממתינים עד 60 שניות במקום להיכשל ולהפעיל את הקונטיינר מחדש.
async function waitForDb() {
  for (let i = 1; ; i++) {
    try { await pool.query("select 1"); return; }
    catch (e) {
      if (i >= 30) throw e;
      console.log(`… waiting for database (${i}/30): ${(e as Error).message || (e as { code?: string }).code}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

(async () => {
  await waitForDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ migrations applied");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
