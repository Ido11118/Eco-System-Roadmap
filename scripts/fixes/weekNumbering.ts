// תיקון נתונים חד-פעמי: מספור השבועות (ראה src/lib/weekFix.ts).
// רץ בעלייה (אחרי המיגרציות), פעם אחת בלבד — מסומן ב-app_settings. הכל בטרנזקציה אחת: או שהכל עובר, או ששום דבר לא משתנה.
//
// מה משתנה: תאריכי ההתחלה/סיום של כל התכולות (כולל מחוקות) — לאותו מספר שבוע במספור הנכון, וכן בתוך תמונות המצב
// (אחרת "תכנון מול ביצוע" היה מראה שכל התכולות הוקדמו בשבוע).
// שלב 2 (בהמשך הקובץ): אבני דרך וספרינטים — אותו כלל, כך שכל מה שבמסך נשאר באותו מספר שבוע.
// מה לא משתנה: חגים ומועדים שנוספו מ-scripts/holidays.ts (נוצרו לפי תאריכי לוח שנה אמיתיים), והשיוך לשורות.
import { eq, sql } from "drizzle-orm";
import { db as appDb } from "../../src/db";
import { appSettings, auditLogs, milestones, snapshotRevisions, sprints, workItems, workRows } from "../../src/db/schema";
import { remapLegacyDate, remapLegacyWeek } from "../../src/lib/weekFix";
import { weekStartOf } from "../../src/lib/weeks";
import { HOLIDAYS } from "../holidays";

const KEY = "fix_week_numbering_v1";

type Item = { id: number; rowId: number; name: string; startWeek: string; endWeek: string };

/** חגים מתוך scripts/holidays.ts (בשורת "גורמים משפיעים", שלא נערכו) — תאריכי לוח שנה אמיתיים, לא מזיזים */
const holidayKeys = new Set(HOLIDAYS.map((h) => `${h.name}|${weekStartOf(h.from)}|${weekStartOf(h.to)}`));
const isHoliday = (i: Item, influenceRows: Set<number>) => influenceRows.has(i.rowId) && holidayKeys.has(`${i.name}|${i.startWeek}|${i.endWeek}`);

export async function applyWeekNumberingFix(db: typeof appDb = appDb): Promise<string> {
  return db.transaction(async (tx) => {
    const [done] = await tx.select().from(appSettings).where(eq(appSettings.key, KEY));
    if (done) return "already applied";
    await tx.execute(sql`LOCK TABLE work_items IN EXCLUSIVE MODE`); // אף אחד לא כותב תכולות בזמן התיקון

    // 1. תכולות (חיות ומחוקות)
    const influence = new Set((await tx.select({ id: workRows.id, kind: workRows.kind }).from(workRows)).filter((r) => r.kind === "INFLUENCE").map((r) => r.id));
    const items: Item[] = await tx.select({ id: workItems.id, rowId: workItems.rowId, name: workItems.name, startWeek: workItems.startWeek, endWeek: workItems.endWeek }).from(workItems);
    const changes = items.filter((i) => !isHoliday(i, influence))
      .map((i) => ({ id: i.id, s: remapLegacyWeek(i.startWeek), e: remapLegacyWeek(i.endWeek), from: i }))
      .filter((c) => c.s !== c.from.startWeek || c.e !== c.from.endWeek);
    // כל התכולות באותה שורה זזות באותו היסט, ולכן לא נוצרות חפיפות. מסירים את אילוץ החפיפה רק לזמן העדכון
    // (בדיקה שורה-שורה בזמן העדכון הייתה נכשלת על חפיפה רגעית), ומחזירים אותו — והוא נבדק מחדש על כל הנתונים.
    await tx.execute(sql`ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_no_overlap`);
    for (const c of changes) {
      await tx.update(workItems).set({ startWeek: c.s, endWeek: c.e, version: sql`${workItems.version} + 1` }).where(eq(workItems.id, c.id));
    }
    await tx.execute(sql`ALTER TABLE work_items ADD CONSTRAINT work_items_no_overlap
      EXCLUDE USING gist (row_id WITH =, daterange(start_week, end_week, '[]') WITH &&)
      WHERE (deleted_at IS NULL AND team_id IS NOT NULL)`);

    // 2. תמונות מצב — אותו כלל על התכולות השמורות בכל גרסה
    const revs = await tx.select({ id: snapshotRevisions.id, data: snapshotRevisions.data }).from(snapshotRevisions);
    let revChanged = 0;
    for (const r of revs) {
      const data = r.data as { rows?: { id: number; kind: string }[]; items?: Item[] } | null;
      if (!data?.items?.length) continue;
      const inf = new Set((data.rows ?? []).filter((x) => x.kind === "INFLUENCE").map((x) => x.id));
      let changed = false;
      const items2 = data.items.map((i) => {
        if (isHoliday(i, inf)) return i;
        const s = remapLegacyWeek(i.startWeek), e = remapLegacyWeek(i.endWeek);
        if (s === i.startWeek && e === i.endWeek) return i;
        changed = true;
        return { ...i, startWeek: s, endWeek: e };
      });
      if (changed) { await tx.update(snapshotRevisions).set({ data: { ...data, items: items2 } }).where(eq(snapshotRevisions.id, r.id)); revChanged++; }
    }

    const summary = `תיקון מספור שבועות: ${changes.length} תכולות ו-${revChanged} גרסאות של תמונות מצב עודכנו כך שכל תכולה נשארת באותו מספר שבוע (שבוע 1 = השבוע שבו חל 1 בינואר)`;
    await tx.insert(auditLogs).values({ userId: null, entityType: "system", entityId: KEY, action: "update", changes: { items: changes.length, revisions: revChanged }, summary });
    await tx.insert(appSettings).values({ key: KEY, value: JSON.stringify({ items: changes.length, revisions: revChanged, at: new Date().toISOString() }) });
    return summary;
  });
}

// ---------------------------------------------------------------------------
// שלב 2: אבני דרך וספרינטים — גם הם נשארים באותו מקום במסך (אותו מספר שבוע, אותו יום בשבוע).
// שלב נפרד עם סימון משלו: בסביבות שבהן שלב 1 כבר רץ (למשל מקומית) הוא משלים את התיקון.
// רק מה שנוצר/נערך לפני שלב 1 (updated_at) — מה שנערך אחריו כבר הוזן לפי המספור הנכון ואסור להזיז אותו שוב.
// ---------------------------------------------------------------------------
const KEY2 = "fix_week_numbering_v2_milestones_sprints";

export async function applyMilestoneSprintFix(db: typeof appDb = appDb): Promise<string> {
  return db.transaction(async (tx) => {
    const [done] = await tx.select().from(appSettings).where(eq(appSettings.key, KEY2));
    if (done) return "already applied";
    const [v1] = await tx.select().from(appSettings).where(eq(appSettings.key, KEY));
    if (!v1) throw new Error("שלב 1 (תכולות) טרם הוחל");
    const cutoff = new Date((JSON.parse(v1.value) as { at: string }).at);
    await tx.execute(sql`LOCK TABLE milestones, sprints IN EXCLUSIVE MODE`);

    const ms = await tx.select({ id: milestones.id, date: milestones.date, updatedAt: milestones.updatedAt }).from(milestones);
    let msN = 0;
    for (const m of ms) {
      if (m.updatedAt >= cutoff) continue;
      const d = remapLegacyDate(m.date);
      if (d === m.date) continue;
      await tx.update(milestones).set({ date: d, version: sql`${milestones.version} + 1` }).where(eq(milestones.id, m.id)); msN++;
    }
    const sps = await tx.select({ id: sprints.id, s: sprints.startDate, e: sprints.endDate, updatedAt: sprints.updatedAt }).from(sprints);
    let spN = 0;
    for (const s of sps) {
      if (s.updatedAt >= cutoff) continue;
      const a = remapLegacyDate(s.s), b = remapLegacyDate(s.e);
      if (a === s.s && b === s.e) continue;
      await tx.update(sprints).set({ startDate: a, endDate: b, version: sql`${sprints.version} + 1` }).where(eq(sprints.id, s.id)); spN++;
    }
    // תמונות מצב שנשמרו לפני שלב 1
    const revs = await tx.select({ id: snapshotRevisions.id, data: snapshotRevisions.data, createdAt: snapshotRevisions.createdAt }).from(snapshotRevisions);
    let revN = 0;
    for (const r of revs) {
      if (r.createdAt >= cutoff) continue;
      const data = r.data as { milestones?: { date: string }[]; sprints?: { startDate: string; endDate: string }[] } | null;
      if (!data) continue;
      const m2 = (data.milestones ?? []).map((m) => ({ ...m, date: remapLegacyDate(m.date) }));
      const s2 = (data.sprints ?? []).map((s) => ({ ...s, startDate: remapLegacyDate(s.startDate), endDate: remapLegacyDate(s.endDate) }));
      if (JSON.stringify(m2) === JSON.stringify(data.milestones ?? []) && JSON.stringify(s2) === JSON.stringify(data.sprints ?? [])) continue;
      await tx.update(snapshotRevisions).set({ data: { ...data, milestones: m2, sprints: s2 } }).where(eq(snapshotRevisions.id, r.id)); revN++;
    }
    const summary = `תיקון מספור שבועות (שלב 2): ${msN} אבני דרך, ${spN} ספרינטים ו-${revN} גרסאות של תמונות מצב עודכנו — נשארים באותו מספר שבוע ובאותו יום בשבוע`;
    await tx.insert(auditLogs).values({ userId: null, entityType: "system", entityId: KEY2, action: "update", changes: { milestones: msN, sprints: spN, revisions: revN }, summary });
    await tx.insert(appSettings).values({ key: KEY2, value: JSON.stringify({ milestones: msN, sprints: spN, revisions: revN, at: new Date().toISOString() }) });
    return summary;
  });
}
