// חגים ומועדים בישראל 2026–2027 → שורת "גורמים משפיעים". הרצה: npm run db:holidays
// בטוח להרצה חוזרת: חג שכבר קיים (אותו שם ואותו שבוע התחלה) לא נוסף שוב.
// התאריכים חושבו מלוח השנה העברי (hebcal, מנהג ישראל). חג מתחיל בערב היום הקודם.
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "../src/db";
import { workItems, workRows, users, statuses, priorities } from "../src/db/schema";
import { weekStartOf, fmtDate } from "../src/lib/weeks";

type Holiday = { name: string; from: string; to: string; note?: string };

export const HOLIDAYS: Holiday[] = [
  // ---- 2026 ----
  { name: "פורים", from: "2026-03-02", to: "2026-03-03", note: "תענית אסתר וערב פורים 01/03; שושן פורים 03/03" },
  { name: "פסח", from: "2026-03-31", to: "2026-04-07", note: "ערב פסח 31/03; חג 01/04; חול המועד 02–06/04; שביעי של פסח 07/04" },
  { name: "יום השואה", from: "2026-04-13", to: "2026-04-13" },
  { name: "יום הזיכרון ויום העצמאות", from: "2026-04-20", to: "2026-04-21" },
  { name: "ל״ג בעומר", from: "2026-05-04", to: "2026-05-04" },
  { name: "שבועות", from: "2026-05-20", to: "2026-05-21", note: "ערב חג 20/05; חג 21/05" },
  { name: "תשעה באב", from: "2026-07-22", to: "2026-07-22", note: "הצום מתחיל בערב 21/07" },
  { name: "ראש השנה תשפ״ז", from: "2026-09-10", to: "2026-09-12", note: "ערב חג 10/09; חג 11–12/09" },
  { name: "יום כיפור", from: "2026-09-19", to: "2026-09-20", note: "ערב יום כיפור 19/09; יום כיפור 20/09" },
  { name: "סוכות ושמחת תורה", from: "2026-09-24", to: "2026-10-02", note: "ערב חג 24/09; חג 25/09; חול המועד 26/09–01/10; שמחת תורה 02/10" },
  { name: "חנוכה", from: "2026-12-04", to: "2026-12-11", note: "הדלקת נר ראשון בערב 03/12" },
  // ---- 2027 ----
  { name: "פורים", from: "2027-03-22", to: "2027-03-23", note: "תענית אסתר וערב פורים 21/03; שושן פורים 23/03" },
  { name: "פסח", from: "2027-04-20", to: "2027-04-27", note: "ערב פסח 20/04; חג 21/04; חול המועד 22–26/04; שביעי של פסח 27/04" },
  { name: "יום השואה", from: "2027-05-03", to: "2027-05-03" },
  { name: "יום הזיכרון ויום העצמאות", from: "2027-05-10", to: "2027-05-11" },
  { name: "ל״ג בעומר", from: "2027-05-24", to: "2027-05-24" },
  { name: "שבועות", from: "2027-06-09", to: "2027-06-10", note: "ערב חג 09/06; חג 10/06" },
  { name: "תשעה באב", from: "2027-08-11", to: "2027-08-11", note: "הצום מתחיל בערב 10/08" },
  { name: "ראש השנה תשפ״ח", from: "2027-09-30", to: "2027-10-02", note: "ערב חג 30/09; חג 01–02/10" },
  { name: "יום כיפור", from: "2027-10-09", to: "2027-10-10", note: "ערב יום כיפור 09/10; יום כיפור 10/10" },
  { name: "סוכות ושמחת תורה", from: "2027-10-14", to: "2027-10-22", note: "ערב חג 14/10; חג 15/10; חול המועד 16–21/10; שמחת תורה 22/10" },
  { name: "חנוכה", from: "2027-12-24", to: "2027-12-31", note: "הדלקת נר ראשון בערב 23/12" },
];

async function main() {
  const [row] = await db.select().from(workRows).where(and(eq(workRows.kind, "INFLUENCE"), isNull(workRows.deletedAt)));
  if (!row) throw new Error('שורת "גורמים משפיעים" לא נמצאה — יש להריץ קודם npm run db:seed');
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "SUPER"));
  const [st] = await db.select({ key: statuses.key }).from(statuses).where(eq(statuses.isDefault, true));
  const [pr] = await db.select({ key: priorities.key }).from(priorities).where(eq(priorities.isDefault, true));
  const existing = await db.select({ name: workItems.name, start: workItems.startWeek }).from(workItems)
    .where(and(eq(workItems.rowId, row.id), isNull(workItems.deletedAt)));
  const has = new Set(existing.map((e) => `${e.name}|${e.start}`));
  let added = 0;
  for (const h of HOLIDAYS) {
    const startWeek = weekStartOf(h.from), endWeek = weekStartOf(h.to);
    if (has.has(`${h.name}|${startWeek}`)) continue;
    const dates = h.from === h.to ? fmtDate(h.from) : `${fmtDate(h.from)}–${fmtDate(h.to)}`;
    await db.insert(workItems).values({
      name: h.name, rowId: row.id, teamId: null, startWeek, endWeek, status: st.key, priority: pr.key,
      notes: h.note ? `${dates} · ${h.note}` : dates,
      createdById: admin?.id ?? null, updatedById: admin?.id ?? null,
    });
    added++;
  }
  console.log(`✓ holidays: ${added} added, ${HOLIDAYS.length - added} already existed`);
}

if (process.argv[1]?.includes("holidays")) main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
