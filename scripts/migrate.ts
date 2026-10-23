import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db";
import { applyMilestoneSprintFix, applyWeekNumberingFix } from "./fixes/weekNumbering";

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
  // תיקוני נתונים חד-פעמיים. כישלון לא עוצר את עליית השרת (הטרנזקציה מתבטלת והנתונים נשארים כמו שהיו) — אבל נרשם בבירור בלוג
  try { console.log(`✓ week numbering fix: ${await applyWeekNumberingFix(db)}`); }
  catch (e) { console.error("!! week numbering fix FAILED — data left unchanged:", e); }
  try { console.log(`✓ week numbering fix (milestones/sprints): ${await applyMilestoneSprintFix(db)}`); }
  catch (e) { console.error("!! week numbering fix (milestones/sprints) FAILED — data left unchanged:", e); }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
