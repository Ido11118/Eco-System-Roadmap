// נתוני הדגמה (אופציונלי): npm run db:demo — מוסיף תכולות לדוגמה רק אם אין תכולות במערכת.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { users, workRows, workItems, milestones, sprints } from "../src/db/schema";
import { addWeeks, currentWeekIL } from "../src/lib/weeks";

const NAMES = ["מודול דוחות", "תיקוני באגים", "שדרוג תשתית", "ממשק משתמש חדש", "אינטגרציה עם מערכת X", "שיפורי ביצועים",
  "מנגנון הרשאות", "מסך ניהול", "גרסה 2.4", "מחקר היתכנות", "אוטומציה לבדיקות", "מיגרציית נתונים", "לוח בקרה", "התראות בזמן אמת"];
const STATUSES = ["PLANNED", "PLANNED", "IN_PROGRESS", "IN_PROGRESS", "DONE", "BLOCKED", "WAITING", "POSTPONED"] as const;
const PRIOS = ["NONE", "NONE", "HIGH", "MEDIUM", "CRITICAL", "LOW"] as const;

async function main() {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(workItems);
  if (c > 0) { console.log("items already exist — skipping demo data"); return; }
  const [admin] = await db.select().from(users).where(eq(users.role, "SUPER"));
  const uid = admin?.id ?? null;
  const rows = await db.select().from(workRows).where(and(eq(workRows.kind, "TEAM"), isNull(workRows.deletedAt))).orderBy(asc(workRows.teamId), asc(workRows.sortOrder));
  const cw = currentWeekIL();
  // mulberry32 — PRNG דטרמיניסטי
  let seed = 42;
  const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rnd = (n: number) => Math.floor(rand() * n);
  for (const r of rows) {
    let w = -10 + rnd(4);
    while (w < 20) {
      const len = 1 + rnd(5);
      const start = addWeeks(cw, w), end = addWeeks(cw, w + len - 1);
      let status: string = STATUSES[rnd(STATUSES.length)];
      if (w + len < 0 && rnd(3)) status = "DONE";
      if (w > 2 && status === "DONE") status = "PLANNED";
      if (w <= 0 && w + len > 0 && rnd(4)) status = "IN_PROGRESS";
      if (w > 0 && status === "IN_PROGRESS") status = "PLANNED";
      await db.insert(workItems).values({ name: NAMES[rnd(NAMES.length)], rowId: r.id, teamId: r.teamId, startWeek: start, endWeek: end,
        status, priority: PRIOS[rnd(PRIOS.length)], notes: status === "BLOCKED" ? "ממתין לאישור תקציב" : "",
        createdById: uid, updatedById: uid });
      w += len + rnd(3);
    }
  }
  const cross = await db.select().from(workRows).where(and(sql`${workRows.kind} <> 'TEAM'`, isNull(workRows.deletedAt)));
  const ev = cross.find((r) => r.kind === "CROSS_EVENT")!; // חגים: npm run db:holidays
  const crossItems = [
    { row: ev, name: "הצגת תוכנית רבעונית Q4", s: "2026-10-04", e: "2026-10-04" },
    { row: ev, name: "כנס שנתי", s: "2026-11-15", e: "2026-11-15" },
    { row: ev, name: "דיון היערכות 2027", s: "2026-12-13", e: "2026-12-20" },
  ];
  for (const x of crossItems) await db.insert(workItems).values({ name: x.name, rowId: x.row.id, teamId: null, startWeek: x.s, endWeek: x.e, status: "PLANNED", priority: "NONE", createdById: uid, updatedById: uid });
  await db.insert(milestones).values([
    { name: "תחילת Q4", date: "2026-10-01", teamId: null, createdById: uid, updatedById: uid },
    { name: "הקפאת גרסה", date: "2026-11-05", teamId: 901, createdById: uid, updatedById: uid },
    { name: "מבצע", date: "2026-10-20", teamId: 402, createdById: uid, updatedById: uid },
  ]);
  // ספרינטים של שבועיים לכל התחום (אג"ם ומשואה)
  for (const domainId of [2, 9]) for (let i = 0; i < 6; i++) {
    const s = addWeeks(cw, -4 + i * 2);
    const end = new Date(Date.parse(s) + 11 * 86400000).toISOString().slice(0, 10); // ראשון עד חמישי של השבוע השני
    await db.insert(sprints).values({ name: `Sprint ${30 + i}`, startDate: s, endDate: end, domainId, createdById: uid, updatedById: uid });
  }
  console.log("✓ demo data inserted");
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
