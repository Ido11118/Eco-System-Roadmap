import "server-only";
// מבנה הגאנט (ניהול מערכת, מנהל המערכת בלבד): תחומים קבועים; צוותים — הוספה, שינוי שם, שינוי סדר והסרה.
// ההרשאות לפי תחום, ולכן שינויי צוותים בתוך תחום אינם משנים הרשאות של אף משתמש.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { domains, milestones, teams, workItems, workRows } from "@/db/schema";
import { DEFAULT_ROWS_PER_TEAM } from "@/lib/org";
import type { Me } from "@/lib/types";
import { ApiError } from "./errors";
import { audit } from "./plan";

const assertSuper = (me: Me) => { if (me.role !== "SUPER") throw new ApiError(403, "פעולה זו זמינה למנהל המערכת בלבד"); };
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export type StructureTeam = { id: number; name: string; key: string; items: number; milestones: number };
export type StructureDomain = { id: number; name: string; teams: StructureTeam[] };

export async function loadStructure(me: Me): Promise<StructureDomain[]> {
  assertSuper(me);
  const [ds, ts, itemCounts, msCounts] = await Promise.all([
    db.select().from(domains).orderBy(asc(domains.sortOrder)),
    db.select().from(teams).where(isNull(teams.archivedAt)).orderBy(asc(teams.sortOrder)),
    db.select({ teamId: workItems.teamId, c: sql<number>`count(*)::int` }).from(workItems).where(isNull(workItems.deletedAt)).groupBy(workItems.teamId),
    db.select({ teamId: milestones.teamId, c: sql<number>`count(*)::int` }).from(milestones).where(isNull(milestones.deletedAt)).groupBy(milestones.teamId),
  ]);
  const ic = new Map(itemCounts.map((r) => [r.teamId, r.c])), mc = new Map(msCounts.map((r) => [r.teamId, r.c]));
  return ds.map((d) => ({
    id: d.id, name: d.name,
    teams: ts.filter((t) => t.domainId === d.id).map((t) => ({ id: t.id, name: t.name, key: t.key, items: ic.get(t.id) ?? 0, milestones: mc.get(t.id) ?? 0 })),
  }));
}

/** שם צוות ייחודי בתוך התחום (בין הצוותים הפעילים) — כדי שלא יהיו שני "עזרים 1" באותו תחום */
async function assertUniqueName(domainId: number, name: string, exceptId?: number) {
  const ts = await db.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.domainId, domainId), isNull(teams.archivedAt)));
  if (ts.some((t) => t.id !== exceptId && norm(t.name) === norm(name))) throw new ApiError(409, `כבר קיים צוות בשם "${name.trim()}" בתחום הזה`);
}

export async function createTeam(me: Me, domainId: number, name: string) {
  assertSuper(me);
  const [d] = await db.select().from(domains).where(eq(domains.id, domainId));
  if (!d) throw new ApiError(400, "תחום לא קיים");
  await assertUniqueName(domainId, name);
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE`); // מזהה חדש בלי התנגשות בהוספה מקבילה
    const all = await tx.select({ id: teams.id, domainId: teams.domainId, sortOrder: teams.sortOrder }).from(teams);
    // מזהה בסגנון הקיים (תחום 2 → 201, 202...), ואם הטווח מלא — המזהה הפנוי הבא
    const inDomain = all.filter((t) => t.id > domainId * 100 && t.id < domainId * 100 + 100).map((t) => t.id);
    let id = Math.max(domainId * 100, ...inDomain) + 1;
    if (id >= domainId * 100 + 100 || all.some((t) => t.id === id)) id = Math.max(0, ...all.map((t) => t.id)) + 1;
    const sortOrder = Math.max(0, ...all.filter((t) => t.domainId === domainId).map((t) => t.sortOrder)) + 10;
    const [t] = await tx.insert(teams).values({ id, key: `team-${id}`, name: name.trim(), domainId, sortOrder }).returning();
    for (let i = 0; i < DEFAULT_ROWS_PER_TEAM; i++) await tx.insert(workRows).values({ kind: "TEAM", teamId: id, sortOrder: (i + 1) * 1000, createdById: me.id });
    await audit(tx, me.id, "team", id, "create", { domainId, name: t.name }, `נוסף צוות "${t.name}" לתחום ${d.name}`);
    return { id: t.id, name: t.name };
  });
}

/** סדר הצוותים בתוך תחום (גרירה במסך "מבנה הגאנט"): הרשימה חייבת לכלול בדיוק את הצוותים הפעילים בתחום */
export async function reorderTeams(me: Me, domainId: number, teamIds: number[]) {
  assertSuper(me);
  return db.transaction(async (tx) => {
    const cur = await tx.select({ id: teams.id, name: teams.name, sortOrder: teams.sortOrder }).from(teams)
      .where(and(eq(teams.domainId, domainId), isNull(teams.archivedAt))).for("update");
    const same = cur.length === teamIds.length && new Set(teamIds).size === teamIds.length && teamIds.every((id) => cur.some((t) => t.id === id));
    if (!same) throw new ApiError(409, "רשימת הצוותים השתנתה בינתיים (צוות נוסף או הוסר). רענן ונסה שוב.");
    for (let i = 0; i < teamIds.length; i++) await tx.update(teams).set({ sortOrder: (i + 1) * 10 }).where(eq(teams.id, teamIds[i]));
    const names = teamIds.map((id) => cur.find((t) => t.id === id)!.name);
    await audit(tx, me.id, "team", domainId, "reorder", { teamIds }, `שונה סדר הצוותים: ${names.join(" ← ")}`);
    return { ok: true };
  });
}

async function activeTeam(id: number) {
  const [t] = await db.select().from(teams).where(and(eq(teams.id, id), isNull(teams.archivedAt)));
  if (!t) throw new ApiError(404, "הצוות לא נמצא");
  return t;
}

export async function renameTeam(me: Me, id: number, name: string) {
  assertSuper(me);
  const t = await activeTeam(id);
  if (t.name === name.trim()) return { id, name: t.name };
  await assertUniqueName(t.domainId, name, id);
  await db.update(teams).set({ name: name.trim() }).where(eq(teams.id, id));
  await audit(db, me.id, "team", id, "update", { name: { from: t.name, to: name.trim() } }, `שם צוות שונה: ${t.name} ← ${name.trim()}`);
  return { id, name: name.trim() };
}

/** התוכן הפעיל של צוות — מוצג למנהל לפני ההסרה */
export async function teamContents(me: Me, id: number) {
  assertSuper(me);
  await activeTeam(id);
  const [items, ms] = await Promise.all([
    db.select({ id: workItems.id, name: workItems.name, startWeek: workItems.startWeek, endWeek: workItems.endWeek, status: workItems.status })
      .from(workItems).where(and(eq(workItems.teamId, id), isNull(workItems.deletedAt))).orderBy(asc(workItems.startWeek)),
    db.select({ id: milestones.id, name: milestones.name, date: milestones.date })
      .from(milestones).where(and(eq(milestones.teamId, id), isNull(milestones.deletedAt))).orderBy(asc(milestones.date)),
  ]);
  return { items, milestones: ms };
}

/**
 * הסרת צוות: הצוות עובר לארכיון (נעלם מהגאנט, מהסינון ומכל הבחירות), והתכולות, השורות ואבני הדרך שלו נמחקים
 * במחיקה רכה. שום דבר לא נמחק פיזית — ההיסטוריה ותמונות המצב נשמרות. לתחום חייב להישאר לפחות צוות אחד.
 */
export async function archiveTeam(me: Me, id: number) {
  assertSuper(me);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM teams WHERE id = ${id} FOR UPDATE`);
    const [t] = await tx.select().from(teams).where(and(eq(teams.id, id), isNull(teams.archivedAt)));
    if (!t) throw new ApiError(404, "הצוות לא נמצא");
    const [{ c }] = await tx.select({ c: sql<number>`count(*)::int` }).from(teams).where(and(eq(teams.domainId, t.domainId), isNull(teams.archivedAt)));
    if (c <= 1) throw new ApiError(400, "לא ניתן להסיר את הצוות האחרון בתחום — לתחום חייב להישאר לפחות צוות אחד");
    const now = new Date();
    const items = await tx.update(workItems).set({ deletedAt: now, deletedById: me.id })
      .where(and(eq(workItems.teamId, id), isNull(workItems.deletedAt))).returning({ id: workItems.id });
    const ms = await tx.update(milestones).set({ deletedAt: now })
      .where(and(eq(milestones.teamId, id), isNull(milestones.deletedAt))).returning({ id: milestones.id });
    const rows = await tx.update(workRows).set({ deletedAt: now, deletedById: me.id })
      .where(and(eq(workRows.teamId, id), isNull(workRows.deletedAt))).returning({ id: workRows.id });
    await tx.update(teams).set({ archivedAt: now }).where(eq(teams.id, id));
    for (const i of items) await audit(tx, me.id, "item", i.id, "delete", null, `נמחקה יחד עם הצוות "${t.name}"`);
    await audit(tx, me.id, "team", id, "delete", { itemIds: items.map((x) => x.id), milestoneIds: ms.map((x) => x.id), rowIds: rows.map((x) => x.id) },
      `הוסר צוות "${t.name}" (${items.length} תכולות, ${ms.length} אבני דרך)`);
    return { items: items.length, milestones: ms.length };
  });
}

