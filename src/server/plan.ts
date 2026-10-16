import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  auditLogs, domains, milestones, sprints, teams, users, workItems, workRows,
} from "@/db/schema";
import type { ItemDTO, Me, MilestoneDTO, PlanData, RowDTO, SprintDTO } from "@/lib/types";
import { ApiError } from "./errors";
import { loadCatalog } from "./catalog";
import type { Catalog } from "@/lib/catalog";

// ---------------------------------------------------------------------------
// טעינת התוכנית הנוכחית (מקור הנתונים היחיד לכל התצוגות)
// ---------------------------------------------------------------------------

const iso = (d: Date | null) => (d ? d.toISOString() : "");

export function itemToDTO(i: typeof workItems.$inferSelect): ItemDTO {
  return {
    id: i.id, name: i.name, rowId: i.rowId, teamId: i.teamId, startWeek: i.startWeek, endWeek: i.endWeek,
    status: i.status, priority: i.priority, notes: i.notes, version: i.version,
    createdAt: iso(i.createdAt), createdById: i.createdById, updatedAt: iso(i.updatedAt), updatedById: i.updatedById,
  };
}
export function rowToDTO(r: typeof workRows.$inferSelect): RowDTO {
  return { id: r.id, kind: r.kind, teamId: r.teamId, sortOrder: r.sortOrder, version: r.version };
}
export function msToDTO(m: typeof milestones.$inferSelect): MilestoneDTO {
  return {
    id: m.id, name: m.name, date: m.date, teamId: m.teamId, notes: m.notes, version: m.version,
    createdById: m.createdById, createdAt: iso(m.createdAt), updatedAt: iso(m.updatedAt), updatedById: m.updatedById,
  };
}
export function sprintToDTO(s: typeof sprints.$inferSelect): SprintDTO {
  return {
    id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate, domainId: s.domainId, notes: s.notes,
    version: s.version, createdById: s.createdById, createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
    updatedById: s.updatedById,
  };
}

export async function loadPlan(q: Tx | typeof db = db): Promise<PlanData> {
  const [d, t, r, i, m, s, u] = await Promise.all([
    q.select().from(domains).orderBy(asc(domains.sortOrder)),
    q.select().from(teams).orderBy(asc(teams.sortOrder)),
    q.select().from(workRows).where(isNull(workRows.deletedAt)).orderBy(asc(workRows.sortOrder)),
    q.select().from(workItems).where(isNull(workItems.deletedAt)).orderBy(asc(workItems.id)),
    q.select().from(milestones).where(isNull(milestones.deletedAt)).orderBy(asc(milestones.date)),
    q.select().from(sprints).where(isNull(sprints.deletedAt)).orderBy(asc(sprints.startDate)),
    // רק משתמשים שאושרו אי פעם (כולל מושעים — כדי שיוצגו כיוצרים של תכולות); ממתינים ונדחים אינם נחשפים
    q.select({ id: users.id, fullName: users.fullName }).from(users).where(isNotNull(users.approvedAt)),
  ]);
  return {
    domains: d.map((x) => ({ id: x.id, key: x.key, name: x.name, sortOrder: x.sortOrder, isSingleTeam: x.isSingleTeam })),
    teams: t.map((x) => ({ id: x.id, key: x.key, name: x.name, domainId: x.domainId, sortOrder: x.sortOrder })),
    rows: r.map(rowToDTO),
    items: i.map(itemToDTO),
    milestones: m.map(msToDTO),
    sprints: s.map(sprintToDTO),
    users: u,
  };
}

// ---------------------------------------------------------------------------
// הרשאות
// ---------------------------------------------------------------------------

// שאילתה בכל בדיקה (טבלה זעירה) — ללא מטמון שעלול להתיישן אחרי שינוי מבנה ארגוני
async function teamDomain(teamId: number): Promise<number> {
  const [t] = await db.select({ d: teams.domainId }).from(teams).where(eq(teams.id, teamId));
  if (!t) throw new ApiError(400, "צוות לא קיים");
  return t.d;
}

export async function canEditTeam(me: Me, teamId: number) {
  const domainId = await teamDomain(teamId); // מאמת קיום הצוות גם עבור Super User
  if (me.role === "SUPER") return true;
  return me.domainIds.includes(domainId);
}
export function canEditCross(me: Me) {
  return me.role === "SUPER" || me.canEditCross;
}
async function assertTeam(me: Me, teamId: number) {
  if (!(await canEditTeam(me, teamId))) throw new ApiError(403, "אין לך הרשאת עריכה לתחום זה");
}
/** עריכת ספרינט: הרשאה לתחום (ספרינט שייך לתחום כולו) */
async function assertDomain(me: Me, domainId: number) {
  const [d] = await db.select({ id: domains.id }).from(domains).where(eq(domains.id, domainId));
  if (!d) throw new ApiError(400, "תחום לא קיים");
  if (me.role !== "SUPER" && !me.domainIds.includes(domainId)) throw new ApiError(403, "אין לך הרשאת עריכה לתחום זה");
}
function assertCross(me: Me) {
  if (!canEditCross(me)) throw new ApiError(403, "אין לך הרשאת עריכה למידע הרוחבי");
}
async function assertRow(me: Me, row: { kind: string; teamId: number | null }) {
  if (row.kind === "TEAM") await assertTeam(me, row.teamId!);
  else assertCross(me);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function audit(
  q: Tx | typeof db, userId: number | null, entityType: string, entityId: string | number, action: string,
  changes?: Record<string, unknown> | null, summary = "",
) {
  await q.insert(auditLogs).values({ userId, entityType, entityId: String(entityId), action, changes: changes ?? null, summary });
}

function diff<T extends Record<string, unknown>>(before: T, patch: Partial<T>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(patch)) {
    if (patch[k] !== undefined && before[k] !== patch[k]) out[k] = { from: before[k], to: patch[k] };
  }
  return out;
}

const FIELD_LABELS: Record<string, string> = {
  name: "שם", status: "סטטוס", priority: "תיעדוף", notes: "הערות", startWeek: "שבוע התחלה", endWeek: "שבוע סיום",
  rowId: "שורה", teamId: "צוות", date: "תאריך", startDate: "תאריך התחלה", endDate: "תאריך סיום",
};
function summarizeDiff(d: Record<string, { from: unknown; to: unknown }>, cat?: Catalog) {
  return Object.entries(d).map(([k, v]) => {
    const fmt = (x: unknown) => k === "status" ? (cat?.status(String(x)).label ?? String(x)) : k === "priority" ? (cat?.priority(String(x)).label ?? String(x)) : k === "notes" ? "…" : String(x);
    return `${FIELD_LABELS[k] ?? k}: ${fmt(v.from)} ← ${fmt(v.to)}`;
  }).join(" · ");
}

// ---------------------------------------------------------------------------
// שורות
// ---------------------------------------------------------------------------

async function getRowForUpdate(tx: Tx, rowId: number) {
  // נעילת השורה מונעת יצירה מקבילית של תכולות חופפות
  const r = await tx.execute(sql`SELECT id FROM work_rows WHERE id = ${rowId} AND deleted_at IS NULL FOR UPDATE`);
  if (!r.rows.length) throw new ApiError(404, "השורה לא נמצאה (ייתכן שנמחקה)");
  const [row] = await tx.select().from(workRows).where(eq(workRows.id, rowId));
  return row;
}

export async function createRow(me: Me, teamId: number, anchorRowId?: number, position: "above" | "below" = "below") {
  await assertTeam(me, teamId);
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(workRows)
      .where(and(eq(workRows.teamId, teamId), isNull(workRows.deletedAt))).orderBy(asc(workRows.sortOrder));
    let sortOrder: number;
    const idx = anchorRowId ? rows.findIndex((r) => r.id === anchorRowId) : -1;
    if (idx === -1) sortOrder = (rows[rows.length - 1]?.sortOrder ?? 0) + 1000;
    else if (position === "above") sortOrder = idx === 0 ? rows[0].sortOrder - 1000 : (rows[idx - 1].sortOrder + rows[idx].sortOrder) / 2;
    else sortOrder = idx === rows.length - 1 ? rows[idx].sortOrder + 1000 : (rows[idx].sortOrder + rows[idx + 1].sortOrder) / 2;
    const [row] = await tx.insert(workRows).values({ kind: "TEAM", teamId, sortOrder, createdById: me.id }).returning();
    await audit(tx, me.id, "row", row.id, "create", { teamId }, "נוספה שורה");
    return rowToDTO(row);
  });
}

/** ifEmpty: הלקוח מחק בלי חלון אישור כי השורה נראתה לו ריקה — אם בינתיים נוסף לה תוכן, המחיקה נדחית */
export async function deleteRow(me: Me, rowId: number, opts?: { ifEmpty?: boolean }) {
  return db.transaction(async (tx) => {
    const row = await getRowForUpdate(tx, rowId);
    if (row.kind !== "TEAM") throw new ApiError(400, "לא ניתן למחוק שורה רוחבית");
    await assertTeam(me, row.teamId!);
    if (opts?.ifEmpty) {
      const [any] = await tx.select({ id: workItems.id }).from(workItems)
        .where(and(eq(workItems.rowId, rowId), isNull(workItems.deletedAt))).limit(1);
      if (any) throw new ApiError(409, "בינתיים נוסף לשורה תוכן על ידי משתמש אחר. הנתונים רועננו — בדוק ונסה שוב.", { conflict: "version" });
    }
    const now = new Date();
    const items = await tx.update(workItems).set({ deletedAt: now, deletedById: me.id })
      .where(and(eq(workItems.rowId, rowId), isNull(workItems.deletedAt))).returning({ id: workItems.id });
    await tx.update(workRows).set({ deletedAt: now, deletedById: me.id, version: sql`${workRows.version} + 1` }).where(eq(workRows.id, rowId));
    for (const i of items) await audit(tx, me.id, "item", i.id, "delete", null, "נמחקה יחד עם השורה");
    await audit(tx, me.id, "row", rowId, "delete", { itemIds: items.map((i) => i.id) }, `נמחקה שורה (${items.length} תכולות)`);
    return { deletedItemIds: items.map((i) => i.id), deletedAt: now.toISOString() };
  });
}

export async function restoreRow(me: Me, rowId: number) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(workRows).where(eq(workRows.id, rowId));
    if (!row || !row.deletedAt) throw new ApiError(404, "אין מה לשחזר");
    await assertTeam(me, row.teamId!);
    await tx.update(workRows).set({ deletedAt: null, deletedById: null, version: sql`${workRows.version} + 1` }).where(eq(workRows.id, rowId));
    // משחזרים רק תכולות שנמחקו באותה פעולה
    const restored = await tx.update(workItems).set({ deletedAt: null, deletedById: null, version: sql`${workItems.version} + 1` })
      .where(and(eq(workItems.rowId, rowId), eq(workItems.deletedAt, row.deletedAt))).returning({ id: workItems.id });
    await audit(tx, me.id, "row", rowId, "restore", null, `שורה שוחזרה (${restored.length} תכולות)`);
    for (const i of restored) await audit(tx, me.id, "item", i.id, "restore", null, "שוחזרה יחד עם השורה");
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// תכולות
// ---------------------------------------------------------------------------

async function assertNoOverlap(tx: Tx, rowId: number, rowKind: string, start: string, end: string, exceptId?: number) {
  if (rowKind !== "TEAM") return; // בשורות רוחביות מותרת חפיפה (מוצגת בנתיבים)
  const conds = [
    eq(workItems.rowId, rowId), isNull(workItems.deletedAt),
    sql`${workItems.startWeek} <= ${end}`, sql`${workItems.endWeek} >= ${start}`,
  ];
  if (exceptId) conds.push(ne(workItems.id, exceptId));
  const clash = await tx.select({ id: workItems.id, name: workItems.name }).from(workItems).where(and(...conds)).limit(1);
  if (clash.length) throw new ApiError(409, `הטווח חופף לתכולה "${clash[0].name}" באותה שורה`, { conflict: "overlap" });
}

export type ItemInput = {
  rowId: number; name: string; startWeek: string; endWeek: string;
  status?: string; priority?: string; notes?: string;
};

/** סטטוס/תיעדוף חייבים להיות בקטלוג — הודעה ברורה במקום שגיאת מפתח זר */
function assertInCatalog(cat: Catalog, v: { status?: string; priority?: string }) {
  // cat.statuses / cat.priorities = הפעילים בלבד (ערך בארכיון אינו ניתן לבחירה)
  if (v.status !== undefined && !cat.statuses.some((s) => s.key === v.status)) throw new ApiError(400, "סטטוס לא קיים (ייתכן שנמחק ע\"י מנהל המערכת). רענן את הדף.");
  if (v.priority !== undefined && !cat.priorities.some((p) => p.key === v.priority)) throw new ApiError(400, "תיעדוף לא קיים (ייתכן שנמחק ע\"י מנהל המערכת). רענן את הדף.");
}

export async function createItem(me: Me, input: ItemInput) {
  const cat = await loadCatalog();
  assertInCatalog(cat, input);
  return db.transaction(async (tx) => {
    const row = await getRowForUpdate(tx, input.rowId);
    await assertRow(me, row);
    await assertNoOverlap(tx, row.id, row.kind, input.startWeek, input.endWeek);
    const [it] = await tx.insert(workItems).values({
      name: input.name, rowId: row.id, teamId: row.teamId, startWeek: input.startWeek, endWeek: input.endWeek,
      status: input.status ?? cat.defaultStatus, priority: input.priority ?? cat.defaultPriority, notes: input.notes ?? "",
      createdById: me.id, updatedById: me.id,
    }).returning();
    await audit(tx, me.id, "item", it.id, "create", { name: it.name, startWeek: it.startWeek, endWeek: it.endWeek, status: it.status }, `נוצרה תכולה "${it.name}"`);
    return itemToDTO(it);
  });
}

export type ItemPatch = Partial<{
  name: string; status: string; priority: string; notes: string; startWeek: string; endWeek: string; rowId: number;
}>;

export async function updateItem(me: Me, id: number, version: number, patch: ItemPatch, tx0?: Tx, cat0?: Catalog) {
  const cat = cat0 ?? await loadCatalog();
  assertInCatalog(cat, patch);
  const run = async (tx: Tx) => {
    const [cur] = await tx.select().from(workItems).where(and(eq(workItems.id, id), isNull(workItems.deletedAt)));
    if (!cur) throw new ApiError(404, "התכולה לא נמצאה (ייתכן שנמחקה)");
    const [curRow] = await tx.select().from(workRows).where(eq(workRows.id, cur.rowId));
    await assertRow(me, curRow);
    if (cur.version !== version) {
      throw new ApiError(409, "התכולה עודכנה בינתיים על ידי משתמש אחר. הנתונים רועננו — בדוק ונסה שוב.", { conflict: "version", current: itemToDTO(cur) });
    }
    let targetRow = curRow;
    if (patch.rowId !== undefined && patch.rowId !== cur.rowId) {
      targetRow = await getRowForUpdate(tx, patch.rowId);
      await assertRow(me, targetRow);
      if ((targetRow.kind === "TEAM") !== (curRow.kind === "TEAM")) throw new ApiError(400, "לא ניתן להעביר תכולה בין שורת צוות לשורה רוחבית");
    } else {
      await getRowForUpdate(tx, cur.rowId);
    }
    const start = patch.startWeek ?? cur.startWeek;
    const end = patch.endWeek ?? cur.endWeek;
    if (end < start) throw new ApiError(400, "שבוע הסיום אינו יכול להיות לפני שבוע ההתחלה");
    if (patch.startWeek || patch.endWeek || patch.rowId) await assertNoOverlap(tx, targetRow.id, targetRow.kind, start, end, id);
    const full = { ...patch, teamId: targetRow.teamId };
    const d = diff(cur as unknown as Record<string, unknown>, full as Record<string, unknown>);
    if (!Object.keys(d).length) return itemToDTO(cur);
    const [upd] = await tx.update(workItems).set({
      ...patch, teamId: targetRow.teamId, version: cur.version + 1, updatedAt: new Date(), updatedById: me.id,
    }).where(and(eq(workItems.id, id), eq(workItems.version, version))).returning();
    if (!upd) throw new ApiError(409, "התכולה עודכנה בינתיים על ידי משתמש אחר.", { conflict: "version" });
    const action = d.rowId || d.teamId ? "move" : "update";
    await audit(tx, me.id, "item", id, action, d, summarizeDiff(d, cat));
    return itemToDTO(upd);
  };
  return tx0 ? run(tx0) : db.transaction(run);
}

export async function bulkUpdateItems(me: Me, entries: { id: number; version: number }[], patch: Pick<ItemPatch, "status" | "priority">) {
  const cat = await loadCatalog();
  return db.transaction(async (tx) => {
    // נעילת כל השורות הרלוונטיות מראש בסדר קבוע — מונע Deadlock בין עדכונים מרובים מקבילים
    const ids = [...new Set(entries.map((e) => e.id))];
    const rowIds = [...new Set((await tx.select({ r: workItems.rowId }).from(workItems).where(inArray(workItems.id, ids))).map((x) => x.r))]
      .sort((a, b) => a - b);
    for (const r of rowIds) await tx.execute(sql`SELECT id FROM work_rows WHERE id = ${r} FOR UPDATE`);
    const out: ItemDTO[] = [];
    for (const e of [...entries].sort((a, b) => a.id - b.id)) out.push(await updateItem(me, e.id, e.version, patch, tx, cat));
    return out;
  });
}

export async function deleteItem(me: Me, id: number, version?: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM work_items WHERE id = ${id} FOR UPDATE`);
    const [cur] = await tx.select().from(workItems).where(and(eq(workItems.id, id), isNull(workItems.deletedAt)));
    if (!cur) throw new ApiError(404, "התכולה לא נמצאה");
    if (version !== undefined && cur.version !== version) {
      throw new ApiError(409, "התכולה עודכנה בינתיים על ידי משתמש אחר. הנתונים רועננו — בדוק ונסה שוב.", { conflict: "version" });
    }
    const [row] = await tx.select().from(workRows).where(eq(workRows.id, cur.rowId));
    await assertRow(me, row);
    await tx.update(workItems).set({ deletedAt: new Date(), deletedById: me.id, version: cur.version + 1 }).where(eq(workItems.id, id));
    await audit(tx, me.id, "item", id, "delete", null, `נמחקה תכולה "${cur.name}"`);
    return { ok: true };
  });
}

/**
 * שחזור תכולה שנמחקה — עם אותו ID (כך שהשוואת תכנון מול ביצוע ממשיכה לזהות אותה).
 * אם השורה המקורית נמחקה, או שבינתיים נוספה בה תכולה חופפת — משחזרים לשורה פנויה של אותו צוות (או לשורה חדשה).
 */
export async function restoreItem(me: Me, id: number) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(workItems).where(eq(workItems.id, id));
    if (!cur || !cur.deletedAt) throw new ApiError(404, "אין מה לשחזר");
    const [orig] = await tx.select().from(workRows).where(eq(workRows.id, cur.rowId));
    await assertRow(me, orig);
    const free = async (rowId: number) => {
      if (orig.kind !== "TEAM") return true; // בשורות רוחביות מותרת חפיפה
      const [c] = await tx.select({ id: workItems.id }).from(workItems).where(and(
        eq(workItems.rowId, rowId), isNull(workItems.deletedAt), ne(workItems.id, id),
        sql`${workItems.startWeek} <= ${cur.endWeek}`, sql`${workItems.endWeek} >= ${cur.startWeek}`)).limit(1);
      return !c;
    };
    let targetId: number | null = null;
    if (!orig.deletedAt) { await getRowForUpdate(tx, orig.id); if (await free(orig.id)) targetId = orig.id; }
    if (targetId === null) {
      if (orig.kind !== "TEAM") throw new ApiError(409, "לא ניתן לשחזר: השורה הרוחבית אינה קיימת");
      const rows = await tx.select().from(workRows)
        .where(and(eq(workRows.teamId, orig.teamId!), isNull(workRows.deletedAt))).orderBy(asc(workRows.sortOrder));
      for (const r of rows) { await getRowForUpdate(tx, r.id); if (await free(r.id)) { targetId = r.id; break; } }
      if (targetId === null) {
        const [nr] = await tx.insert(workRows).values({ kind: "TEAM", teamId: orig.teamId, sortOrder: (rows[rows.length - 1]?.sortOrder ?? 0) + 1000, createdById: me.id }).returning();
        await audit(tx, me.id, "row", nr.id, "create", { teamId: orig.teamId }, "נוספה שורה לשחזור תכולה");
        targetId = nr.id;
      }
    }
    const moved = targetId !== cur.rowId;
    const [upd] = await tx.update(workItems).set({ deletedAt: null, deletedById: null, rowId: targetId, version: cur.version + 1, updatedAt: new Date(), updatedById: me.id })
      .where(eq(workItems.id, id)).returning();
    await audit(tx, me.id, "item", id, "restore", moved ? { rowId: { from: cur.rowId, to: targetId } } : null,
      `שוחזרה תכולה "${cur.name}"${moved ? " (לשורה אחרת — המקורית נמחקה או תפוסה)" : ""}`);
    return itemToDTO(upd);
  });
}

/** תכולות שנמחקו (ב-180 הימים האחרונים) — לשחזור עם אותו ID. רק בתחומים שהמשתמש מורשה לערוך. */
export async function listDeletedItems(me: Me) {
  const since = new Date(Date.now() - 180 * 86400000);
  const rows = await db.select({ i: workItems, kind: workRows.kind, rowTeam: workRows.teamId, deletedBy: users.fullName })
    .from(workItems).innerJoin(workRows, eq(workRows.id, workItems.rowId)).leftJoin(users, eq(users.id, workItems.deletedById))
    .where(and(sql`${workItems.deletedAt} is not null`, sql`${workItems.deletedAt} > ${since}`))
    .orderBy(sql`${workItems.deletedAt} desc`).limit(300);
  const teamDomains = new Map((await db.select({ id: teams.id, d: teams.domainId }).from(teams)).map((t) => [t.id, t.d]));
  // מוצגות רק תכולות שהמשתמש מורשה לשחזר (תחומים שיש לו הרשאת עריכה אליהם; רוחבי — רק עם הרשאה רוחבית)
  return rows
    .map((r) => ({
      ...itemToDTO(r.i), deletedAt: r.i.deletedAt!.toISOString(), deletedBy: r.deletedBy ?? "—", rowKind: r.kind,
      canRestore: r.kind === "TEAM" ? me.role === "SUPER" || me.domainIds.includes(teamDomains.get(r.rowTeam!) ?? -1) : canEditCross(me),
    }))
    .filter((r) => r.canRestore);
}

// ---------------------------------------------------------------------------
// אבני דרך וספרינטים
// ---------------------------------------------------------------------------

async function assertTeamOrCross(me: Me, teamId: number | null) {
  if (teamId === null) assertCross(me);
  else await assertTeam(me, teamId);
}

export async function createMilestone(me: Me, v: { name: string; date: string; teamId: number | null; notes?: string }) {
  await assertTeamOrCross(me, v.teamId);
  const [m] = await db.insert(milestones).values({ ...v, notes: v.notes ?? "", createdById: me.id, updatedById: me.id }).returning();
  await audit(db, me.id, "milestone", m.id, "create", { name: m.name, date: m.date }, `נוצרה אבן דרך "${m.name}"`);
  return msToDTO(m);
}

export async function updateMilestone(me: Me, id: number, version: number, patch: Partial<{ name: string; date: string; teamId: number | null; notes: string }>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM milestones WHERE id = ${id} FOR UPDATE`);
    const [cur] = await tx.select().from(milestones).where(and(eq(milestones.id, id), isNull(milestones.deletedAt)));
    if (!cur) throw new ApiError(404, "אבן הדרך לא נמצאה");
    await assertTeamOrCross(me, cur.teamId);
    if (patch.teamId !== undefined) await assertTeamOrCross(me, patch.teamId);
    if (cur.version !== version) throw new ApiError(409, "אבן הדרך עודכנה בינתיים על ידי משתמש אחר.", { conflict: "version" });
    const d = diff(cur as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    if (!Object.keys(d).length) return msToDTO(cur);
    const [upd] = await tx.update(milestones).set({ ...patch, version: cur.version + 1, updatedAt: new Date(), updatedById: me.id })
      .where(and(eq(milestones.id, id), eq(milestones.version, version))).returning();
    if (!upd) throw new ApiError(409, "אבן הדרך עודכנה בינתיים על ידי משתמש אחר.", { conflict: "version" });
    await audit(tx, me.id, "milestone", id, "update", d, summarizeDiff(d));
    return msToDTO(upd);
  });
}

export async function deleteMilestone(me: Me, id: number, restore = false) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM milestones WHERE id = ${id} FOR UPDATE`);
    const [cur] = await tx.select().from(milestones).where(eq(milestones.id, id));
    if (!cur || (restore ? !cur.deletedAt : !!cur.deletedAt)) throw new ApiError(404, restore ? "אין מה לשחזר" : "אבן הדרך לא נמצאה");
    await assertTeamOrCross(me, cur.teamId);
    await tx.update(milestones).set({ deletedAt: restore ? null : new Date(), version: cur.version + 1 }).where(eq(milestones.id, id));
    await audit(tx, me.id, "milestone", id, restore ? "restore" : "delete", null, `${restore ? "שוחזרה" : "נמחקה"} אבן דרך "${cur.name}"`);
    return { ok: true };
  });
}

export async function createSprint(me: Me, v: { name: string; startDate: string; endDate: string; domainId: number; notes?: string }) {
  await assertDomain(me, v.domainId);
  if (v.endDate < v.startDate) throw new ApiError(400, "תאריך הסיום אינו יכול להיות לפני תאריך ההתחלה");
  const [s] = await db.insert(sprints).values({ ...v, notes: v.notes ?? "", createdById: me.id, updatedById: me.id }).returning();
  await audit(db, me.id, "sprint", s.id, "create", { name: s.name }, `נוצר ספרינט "${s.name}"`);
  return sprintToDTO(s);
}

export async function updateSprint(me: Me, id: number, version: number, patch: Partial<{ name: string; startDate: string; endDate: string; domainId: number; notes: string }>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM sprints WHERE id = ${id} FOR UPDATE`);
    const [cur] = await tx.select().from(sprints).where(and(eq(sprints.id, id), isNull(sprints.deletedAt)));
    if (!cur) throw new ApiError(404, "הספרינט לא נמצא");
    await assertDomain(me, cur.domainId);
    if (patch.domainId !== undefined) await assertDomain(me, patch.domainId);
    if (cur.version !== version) throw new ApiError(409, "הספרינט עודכן בינתיים על ידי משתמש אחר.", { conflict: "version" });
    const s = patch.startDate ?? cur.startDate, e = patch.endDate ?? cur.endDate;
    if (e < s) throw new ApiError(400, "תאריך הסיום אינו יכול להיות לפני תאריך ההתחלה");
    const d = diff(cur as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    if (!Object.keys(d).length) return sprintToDTO(cur);
    const [upd] = await tx.update(sprints).set({ ...patch, version: cur.version + 1, updatedAt: new Date(), updatedById: me.id })
      .where(and(eq(sprints.id, id), eq(sprints.version, version))).returning();
    if (!upd) throw new ApiError(409, "הספרינט עודכן בינתיים על ידי משתמש אחר.", { conflict: "version" });
    await audit(tx, me.id, "sprint", id, "update", d, summarizeDiff(d));
    return sprintToDTO(upd);
  });
}

export async function deleteSprint(me: Me, id: number, restore = false) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM sprints WHERE id = ${id} FOR UPDATE`);
    const [cur] = await tx.select().from(sprints).where(eq(sprints.id, id));
    if (!cur || (restore ? !cur.deletedAt : !!cur.deletedAt)) throw new ApiError(404, restore ? "אין מה לשחזר" : "הספרינט לא נמצא");
    await assertDomain(me, cur.domainId);
    await tx.update(sprints).set({ deletedAt: restore ? null : new Date(), version: cur.version + 1 }).where(eq(sprints.id, id));
    await audit(tx, me.id, "sprint", id, restore ? "restore" : "delete", null, `${restore ? "שוחזר" : "נמחק"} ספרינט "${cur.name}"`);
    return { ok: true };
  });
}

export async function itemHistory(entityType: string, entityId: number) {
  const rows = await db.select({
    id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, summary: auditLogs.summary, changes: auditLogs.changes,
    userName: users.fullName,
  }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId))
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, String(entityId))))
    .orderBy(sql`${auditLogs.at} desc`).limit(200);
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}

export { inArray };
