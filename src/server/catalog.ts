import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { statuses, priorities, workItems } from "@/db/schema";
import { makeCatalog, borderFor, contrastText, type Catalog, type CatalogData, type StatusCategory } from "@/lib/catalog";
import type { Me } from "@/lib/types";
import { ApiError } from "./errors";
import { audit } from "./plan";
import { writeCatalogFile } from "./catalogSync";

export async function loadCatalogData(): Promise<CatalogData> {
  const [s, p] = await Promise.all([
    db.select().from(statuses).orderBy(asc(statuses.sortOrder)),
    db.select().from(priorities).orderBy(asc(priorities.sortOrder)),
  ]);
  return {
    statuses: s.map((x) => ({ ...x, category: x.category as StatusCategory })),
    priorities: p,
  };
}
export async function loadCatalog(): Promise<Catalog> {
  return makeCatalog(await loadCatalogData());
}

/** מפתח קבוע לפריט חדש (לא תלוי בשם — שינוי שם לא שובר קשרים) */
function newKey(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}
const nextOrder = async (t: typeof statuses | typeof priorities) =>
  Number((await db.execute(sql`select coalesce(max(sort_order),0)+10 as n from ${t}`)).rows[0].n);

// כל שינוי בהגדרות נכתב גם ל-config/catalog.json (בפיתוח) — כך הוא עולה לפרודקשן עם הדחיפה הבאה
function synced<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  return async (...a: A): Promise<R> => { const r = await fn(...a); await writeCatalogFile(db); return r; };
}

// ---------------------------------------------------------------------------
// סטטוסים
// ---------------------------------------------------------------------------
export type StatusInput = { label: string; bg: string; category: StatusCategory; noteRecommended: boolean; isDefault?: boolean };

async function createStatusImpl(me: Me, v: StatusInput) {
  const key = newKey("S");
  await db.transaction(async (tx) => {
    if (v.isDefault) await tx.update(statuses).set({ isDefault: false }).where(eq(statuses.isDefault, true));
    await tx.insert(statuses).values({
      key, label: v.label, bg: v.bg, fg: contrastText(v.bg), border: borderFor(v.bg), category: v.category,
      noteRecommended: v.noteRecommended, sortOrder: await nextOrder(statuses), isDefault: !!v.isDefault,
    });
    await audit(tx, me.id, "catalog", key, "createStatus", v, `נוסף סטטוס "${v.label}"`);
  });
  return { key };
}

async function updateStatusImpl(me: Me, key: string, v: Partial<StatusInput> & { sortOrder?: number; archived?: boolean }) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(statuses).where(eq(statuses.key, key));
    if (!cur) throw new ApiError(404, "הסטטוס לא נמצא");
    if (cur.archived && v.archived !== false) throw new ApiError(400, "הסטטוס בארכיון. יש לשחזר אותו קודם.");
    if (v.isDefault === false && cur.isDefault) throw new ApiError(400, "חייב להיות סטטוס ברירת מחדל. כדי לשנות — קבע סטטוס אחר כברירת מחדל.");
    if (v.isDefault) await tx.update(statuses).set({ isDefault: false }).where(eq(statuses.isDefault, true));
    const patch = {
      ...(v.label !== undefined && { label: v.label }),
      ...(v.bg !== undefined && { bg: v.bg, fg: contrastText(v.bg), border: borderFor(v.bg) }),
      ...(v.category !== undefined && { category: v.category }),
      ...(v.noteRecommended !== undefined && { noteRecommended: v.noteRecommended }),
      ...(v.sortOrder !== undefined && { sortOrder: v.sortOrder }),
      ...(v.isDefault && { isDefault: true }),
      ...(v.archived === false && { archived: false, replacedBy: null }),
    };
    await tx.update(statuses).set(patch).where(eq(statuses.key, key));
    await audit(tx, me.id, "catalog", key, "updateStatus", { before: cur, patch }, `עודכן סטטוס "${v.label ?? cur.label}"`);
    return { ok: true };
  });
}

/** מחיקת סטטוס. אם יש תכולות בסטטוס הזה — חובה לבחור סטטוס חלופי, והן יועברו אליו (נרשם ביומן). */
async function deleteStatusImpl(me: Me, key: string, replaceWith?: string) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(statuses).where(eq(statuses.key, key));
    if (!cur || cur.archived) throw new ApiError(404, "הסטטוס לא נמצא");
    if (cur.isDefault) throw new ApiError(400, "לא ניתן למחוק את סטטוס ברירת המחדל. קבע קודם סטטוס אחר כברירת מחדל.");
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from work_items where status = ${key}`)).rows as { n: number }[];
    if (n > 0) {
      if (!replaceWith || replaceWith === key) throw new ApiError(409, `יש ${n} תכולות בסטטוס זה. יש לבחור סטטוס חלופי.`, { inUse: n });
      const [rep] = await tx.select().from(statuses).where(eq(statuses.key, replaceWith));
      if (!rep || rep.archived) throw new ApiError(400, "הסטטוס החלופי לא נמצא");
      // כל תכולה מקבלת גרסה חדשה — עריכות מקבילות לא ידרסו בשקט
      await tx.update(workItems).set({ status: replaceWith, version: sql`${workItems.version} + 1`, updatedAt: new Date(), updatedById: me.id })
        .where(eq(workItems.status, key));
    }
    // ארכוב (לא מחיקה): נעלם מהבחירה, אבל תמונות מצב ישנות ממשיכות להציג את שמו וצבעו
    await tx.update(statuses).set({ archived: true, replacedBy: n > 0 ? replaceWith! : null }).where(eq(statuses.key, key));
    await audit(tx, me.id, "catalog", key, "deleteStatus", { replaceWith: replaceWith ?? null, moved: n },
      `נמחק סטטוס "${cur.label}"${n ? ` (${n} תכולות הועברו)` : ""}`);
    return { ok: true, moved: n };
  });
}

// ---------------------------------------------------------------------------
// תיעדופים
// ---------------------------------------------------------------------------
export type PriorityInput = { label: string; color: string; isDefault?: boolean };

async function createPriorityImpl(me: Me, v: PriorityInput) {
  const key = newKey("P");
  await db.transaction(async (tx) => {
    if (v.isDefault) await tx.update(priorities).set({ isDefault: false }).where(eq(priorities.isDefault, true));
    await tx.insert(priorities).values({ key, label: v.label, color: v.color, sortOrder: await nextOrder(priorities), isDefault: !!v.isDefault });
    await audit(tx, me.id, "catalog", key, "createPriority", v, `נוסף תיעדוף "${v.label}"`);
  });
  return { key };
}

async function updatePriorityImpl(me: Me, key: string, v: Partial<PriorityInput> & { sortOrder?: number; archived?: boolean }) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(priorities).where(eq(priorities.key, key));
    if (!cur) throw new ApiError(404, "התיעדוף לא נמצא");
    if (cur.archived && v.archived !== false) throw new ApiError(400, "התיעדוף בארכיון. יש לשחזר אותו קודם.");
    if (v.isDefault === false && cur.isDefault) throw new ApiError(400, "חייב להיות תיעדוף ברירת מחדל. כדי לשנות — קבע תיעדוף אחר כברירת מחדל.");
    if (v.isDefault) await tx.update(priorities).set({ isDefault: false }).where(eq(priorities.isDefault, true));
    const patch = {
      ...(v.label !== undefined && { label: v.label }),
      ...(v.color !== undefined && { color: v.color }),
      ...(v.sortOrder !== undefined && { sortOrder: v.sortOrder }),
      ...(v.isDefault && { isDefault: true }),
      ...(v.archived === false && { archived: false, replacedBy: null }),
    };
    await tx.update(priorities).set(patch).where(eq(priorities.key, key));
    await audit(tx, me.id, "catalog", key, "updatePriority", { before: cur, patch }, `עודכן תיעדוף "${v.label ?? cur.label}"`);
    return { ok: true };
  });
}

async function deletePriorityImpl(me: Me, key: string, replaceWith?: string) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(priorities).where(eq(priorities.key, key));
    if (!cur || cur.archived) throw new ApiError(404, "התיעדוף לא נמצא");
    if (cur.isDefault) throw new ApiError(400, "לא ניתן למחוק את תיעדוף ברירת המחדל. קבע קודם תיעדוף אחר כברירת מחדל.");
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from work_items where priority = ${key}`)).rows as { n: number }[];
    if (n > 0) {
      if (!replaceWith || replaceWith === key) throw new ApiError(409, `יש ${n} תכולות בתיעדוף זה. יש לבחור תיעדוף חלופי.`, { inUse: n });
      const [rep] = await tx.select().from(priorities).where(eq(priorities.key, replaceWith));
      if (!rep || rep.archived) throw new ApiError(400, "התיעדוף החלופי לא נמצא");
      await tx.update(workItems).set({ priority: replaceWith, version: sql`${workItems.version} + 1`, updatedAt: new Date(), updatedById: me.id })
        .where(eq(workItems.priority, key));
    }
    await tx.update(priorities).set({ archived: true, replacedBy: n > 0 ? replaceWith! : null }).where(eq(priorities.key, key));
    await audit(tx, me.id, "catalog", key, "deletePriority", { replaceWith: replaceWith ?? null, moved: n },
      `נמחק תיעדוף "${cur.label}"${n ? ` (${n} תכולות הועברו)` : ""}`);
    return { ok: true, moved: n };
  });
}

/** מספר התכולות בכל סטטוס/תיעדוף — למסך ההגדרות (כדי לדעת אם מחיקה דורשת העברה) */
export async function catalogUsage() {
  const s = (await db.execute(sql`select status as key, count(*)::int as n from work_items where deleted_at is null group by status`)).rows as { key: string; n: number }[];
  const p = (await db.execute(sql`select priority as key, count(*)::int as n from work_items where deleted_at is null group by priority`)).rows as { key: string; n: number }[];
  return { statuses: Object.fromEntries(s.map((x) => [x.key, x.n])), priorities: Object.fromEntries(p.map((x) => [x.key, x.n])) };
}

export const createStatus = synced(createStatusImpl);
export const updateStatus = synced(updateStatusImpl);
export const deleteStatus = synced(deleteStatusImpl);
export const createPriority = synced(createPriorityImpl);
export const updatePriority = synced(updatePriorityImpl);
export const deletePriority = synced(deletePriorityImpl);
