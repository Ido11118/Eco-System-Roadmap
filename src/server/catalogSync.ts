// סנכרון הגדרות הסטטוסים והתיעדוף בין סביבות דרך קובץ בקוד: config/catalog.json
//
// • בפיתוח (מקומי): כל שינוי במסך "ניהול מערכת ← הגדרות" נכתב גם לקובץ. דוחפים אותו לגיט כמו כל קובץ.
// • בעליית השרת (npm run db:seed — רץ אוטומטית ב-Docker/Railway): אם הקובץ השתנה מאז שהוחל לאחרונה —
//   ההגדרות שבו מוחלות על בסיס הנתונים (לפי מפתח). שינויים שנעשו ישירות בפרודקשן נשמרים כל עוד הקובץ לא השתנה.
//
// בכוונה בלי "server-only": גם סקריפט האתחול משתמש במודול הזה.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { statuses, priorities, workItems, backlogItems, appSettings } from "@/db/schema";
import type * as schema from "@/db/schema";

type Db = NodePgDatabase<typeof schema>;
export const CATALOG_FILE = path.join(process.cwd(), "config", "catalog.json");
const HASH_KEY = "catalog_file_hash";
const CONTENT_KEY = "catalog_file_content"; // תוכן הקובץ שהוחל לאחרונה — להשוואה תלת-כיוונית

type FileStatus = { key: string; label: string; bg: string; fg: string; border: string; category: string; noteRecommended: boolean; sortOrder: number; isDefault: boolean; archived: boolean; replacedBy: string | null };
type FilePriority = { key: string; label: string; color: string; sortOrder: number; isDefault: boolean; archived: boolean; replacedBy: string | null };
type CatalogFile = { statuses: FileStatus[]; priorities: FilePriority[] };

const hashOf = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

/** האם לכתוב שינויים לקובץ: בפיתוח כן; בפרודקשן לא (הקוד בקונטיינר לקריאה בלבד) — אלא אם הוגדר במפורש */
export function fileSyncEnabled() {
  if (process.env.CATALOG_FILE_SYNC) return process.env.CATALOG_FILE_SYNC === "true";
  return process.env.NODE_ENV !== "production";
}

async function readDbCatalog(db: Db): Promise<CatalogFile> {
  const [s, p] = await Promise.all([
    db.select().from(statuses).orderBy(asc(statuses.sortOrder), asc(statuses.key)),
    db.select().from(priorities).orderBy(asc(priorities.sortOrder), asc(priorities.key)),
  ]);
  return {
    statuses: s.map((x) => ({ key: x.key, label: x.label, bg: x.bg, fg: x.fg, border: x.border, category: x.category, noteRecommended: x.noteRecommended, sortOrder: x.sortOrder, isDefault: x.isDefault, archived: x.archived, replacedBy: x.replacedBy })),
    priorities: p.map((x) => ({ key: x.key, label: x.label, color: x.color, sortOrder: x.sortOrder, isDefault: x.isDefault, archived: x.archived, replacedBy: x.replacedBy })),
  };
}

const serialize = (c: CatalogFile) => JSON.stringify(c, null, 2) + "\n";

/** כתיבת ההגדרות הנוכחיות לקובץ (בפיתוח בלבד). נקרא אחרי כל שינוי במסך ההגדרות. */
export async function writeCatalogFile(db: Db): Promise<boolean> {
  if (!fileSyncEnabled()) return false;
  try {
    const text = serialize(await readDbCatalog(db));
    fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
    fs.writeFileSync(CATALOG_FILE, text);
    await setHash(db, hashOf(text)); // אותה גרסה כבר "מוחלת" כאן — האתחול הבא לא יחיל אותה שוב
    await setSetting(db, CONTENT_KEY, text);
    return true;
  } catch (e) {
    console.error("[catalog] failed to write config/catalog.json", e);
    return false;
  }
}

async function setSetting(db: Db, key: string, value: string) {
  await db.insert(appSettings).values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
const setHash = (db: Db, hash: string) => setSetting(db, HASH_KEY, hash);

/**
 * החלת הקובץ על בסיס הנתונים — רק אם השתנה מאז ההחלה האחרונה, ורק הערכים שהשתנו בו (השוואה תלת-כיוונית):
 * משווים כל ערך בקובץ לגרסת הקובץ שהוחלה בפעם הקודמת. ערך שלא השתנה בקובץ — לא נוגעים בו בבסיס הנתונים,
 * כך ששינויים שנעשו ישירות בסביבה הזו (למשל צבע שמנהל המערכת שינה בפרודקשן) נשמרים.
 * ערכים חדשים בקובץ נוספים; ערך שנמחק בקובץ (archived + replacedBy) — התכולות שלו מועברות לחלופה.
 * ערכים שקיימים רק בבסיס הנתונים (נוצרו ישירות בסביבה הזו) לא נמחקים.
 */
export async function applyCatalogFile(db: Db): Promise<"applied" | "unchanged" | "missing"> {
  if (!fs.existsSync(CATALOG_FILE)) return "missing";
  const text = fs.readFileSync(CATALOG_FILE, "utf8");
  const hash = hashOf(text);
  const settings = await db.select().from(appSettings);
  const get = (k: string) => settings.find((x) => x.key === k)?.value;
  if (get(HASH_KEY) === hash) {
    if (!get(CONTENT_KEY)) await setSetting(db, CONTENT_KEY, text); // לגרסאות קודמות שלא שמרו תוכן
    return "unchanged";
  }
  const file = JSON.parse(text) as CatalogFile;
  validate(file);
  let prev: CatalogFile | null = null;
  try { prev = get(CONTENT_KEY) ? JSON.parse(get(CONTENT_KEY)!) as CatalogFile : null; } catch { prev = null; }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changedS = file.statuses.filter((x) => !same(x, prev?.statuses.find((p) => p.key === x.key)));
  const changedP = file.priorities.filter((x) => !same(x, prev?.priorities.find((p) => p.key === x.key)));
  const defS = file.statuses.find((x) => x.isDefault)?.key, prevDefS = prev?.statuses.find((x) => x.isDefault)?.key;
  const defP = file.priorities.find((x) => x.isDefault)?.key, prevDefP = prev?.priorities.find((x) => x.isDefault)?.key;
  await db.transaction(async (tx) => {
    for (const s of changedS) {
      const v = { label: s.label, bg: s.bg, fg: s.fg, border: s.border, category: s.category, noteRecommended: s.noteRecommended, sortOrder: s.sortOrder, archived: s.archived, replacedBy: s.replacedBy };
      await tx.insert(statuses).values({ key: s.key, ...v, isDefault: false }).onConflictDoUpdate({ target: statuses.key, set: v });
    }
    for (const p of changedP) {
      const v = { label: p.label, color: p.color, sortOrder: p.sortOrder, archived: p.archived, replacedBy: p.replacedBy };
      await tx.insert(priorities).values({ key: p.key, ...v, isDefault: false }).onConflictDoUpdate({ target: priorities.key, set: v });
    }
    // ברירת מחדל — רק אם השתנתה בקובץ (אינדקס ייחודי חלקי: קודם מנקים, אחר כך מסמנים)
    if (defS && defS !== prevDefS) { await tx.update(statuses).set({ isDefault: false }); await tx.update(statuses).set({ isDefault: true }).where(eq(statuses.key, defS)); }
    if (defP && defP !== prevDefP) { await tx.update(priorities).set({ isDefault: false }); await tx.update(priorities).set({ isDefault: true }).where(eq(priorities.key, defP)); }
    // ערכים שנמחקו בקובץ עם חלופה — מעבירים אליה את התכולות של הסביבה הזו
    for (const s of changedS.filter((x) => x.archived && x.replacedBy)) {
      await tx.update(workItems).set({ status: s.replacedBy!, version: sql`${workItems.version} + 1`, updatedAt: new Date() }).where(eq(workItems.status, s.key));
    }
    for (const p of changedP.filter((x) => x.archived && x.replacedBy)) {
      await tx.update(workItems).set({ priority: p.replacedBy!, version: sql`${workItems.version} + 1`, updatedAt: new Date() }).where(eq(workItems.priority, p.key));
      await tx.update(backlogItems).set({ priority: p.replacedBy!, version: sql`${backlogItems.version} + 1`, updatedAt: new Date() }).where(eq(backlogItems.priority, p.key));
    }
    for (const [k, v] of [[HASH_KEY, hash], [CONTENT_KEY, text]] as const) {
      await tx.insert(appSettings).values({ key: k, value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
    }
  });
  return "applied";
}

function validate(f: CatalogFile) {
  const ok = Array.isArray(f?.statuses) && Array.isArray(f?.priorities);
  if (!ok) throw new Error("config/catalog.json: מבנה לא תקין");
  for (const [name, list] of [["statuses", f.statuses], ["priorities", f.priorities]] as const) {
    const active = (list as { isDefault: boolean; archived: boolean; key: string; replacedBy: string | null }[]);
    if (active.filter((x) => x.isDefault && !x.archived).length !== 1) throw new Error(`config/catalog.json: ב-${name} חייב להיות בדיוק ערך ברירת מחדל פעיל אחד`);
    const keys = new Set(active.map((x) => x.key));
    if (keys.size !== active.length) throw new Error(`config/catalog.json: מפתחות כפולים ב-${name}`);
    const bad = active.find((x) => x.replacedBy && !keys.has(x.replacedBy));
    if (bad) throw new Error(`config/catalog.json: ${bad.key} מוחלף בערך לא קיים (${bad.replacedBy})`);
  }
}
