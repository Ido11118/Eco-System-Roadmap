import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { backlogItems, domains, teams } from "@/db/schema";
import type { BacklogDTO, Me } from "@/lib/types";
import { ApiError } from "./errors";
import { loadCatalog } from "./catalog";
import { audit, createItem, type ItemInput } from "./plan";

// ---------------------------------------------------------------------------
// באקלוג: שייך לתחום (הצוות לא חובה). גלוי ונערך רק ע"י מי שמורשה לערוך את התחום (ומנהל המערכת)
// ---------------------------------------------------------------------------

const toDTO = (b: typeof backlogItems.$inferSelect, activeTeams?: Set<number>): BacklogDTO => ({
  id: b.id, name: b.name, domainId: b.domainId,
  teamId: b.teamId !== null && (!activeTeams || activeTeams.has(b.teamId)) ? b.teamId : null, // צוות שהוסר מהמבנה — כאילו לא נבחר
  priority: b.priority, notes: b.notes, version: b.version,
  createdAt: b.createdAt.toISOString(), createdById: b.createdById, updatedAt: b.updatedAt.toISOString(), updatedById: b.updatedById,
});

const canDomain = (me: Me, domainId: number) => me.role === "SUPER" || me.domainIds.includes(domainId);

async function assertDomain(me: Me, domainId: number) {
  const [d] = await db.select({ id: domains.id }).from(domains).where(eq(domains.id, domainId));
  if (!d) throw new ApiError(400, "תחום לא קיים");
  if (!canDomain(me, domainId)) throw new ApiError(403, "אין לך הרשאת עריכה לתחום זה");
}

/** צוות פעיל → התחום שלו (הצוות קובע את התחום) */
async function teamDomain(teamId: number) {
  const [t] = await db.select({ d: teams.domainId }).from(teams).where(and(eq(teams.id, teamId), isNull(teams.archivedAt)));
  if (!t) throw new ApiError(400, "הצוות לא קיים (ייתכן שהוסר ממבנה הגאנט)");
  return t.d;
}

/** פריט קיים שהמשתמש מורשה אליו. אחרת 404 (גם בלי הרשאה — לא חושפים שהפריט קיים) */
async function getAccessible(me: Me, id: number) {
  const [b] = await db.select().from(backlogItems).where(eq(backlogItems.id, id));
  if (!b || !canDomain(me, b.domainId)) throw new ApiError(404, "הפריט לא נמצא בבאקלוג (ייתכן שכבר הועבר לגאנט או נמחק)");
  return b;
}

function assertVersion(b: { version: number }, version: number) {
  if (b.version !== version) throw new ApiError(409, "הפריט עודכן בינתיים על ידי משתמש אחר. הנתונים רועננו — בדוק ונסה שוב.", { conflict: "version" });
}

async function assertPriority(priority: string | undefined) {
  if (priority === undefined) return;
  const cat = await loadCatalog();
  if (!cat.priorities.some((p) => p.key === priority)) throw new ApiError(400, "תיעדוף לא קיים (ייתכן שנמחק ע\"י מנהל המערכת). רענן את הדף.");
}

export async function listBacklog(me: Me): Promise<BacklogDTO[]> {
  const all = await db.select({ id: domains.id }).from(domains);
  const ids = all.map((d) => d.id).filter((d) => canDomain(me, d));
  if (!ids.length) return [];
  const [rows, active] = await Promise.all([
    db.select().from(backlogItems).where(inArray(backlogItems.domainId, ids)).orderBy(asc(backlogItems.id)),
    db.select({ id: teams.id }).from(teams).where(isNull(teams.archivedAt)),
  ]);
  const activeSet = new Set(active.map((t) => t.id));
  return rows.map((b) => toDTO(b, activeSet));
}

export async function createBacklog(me: Me, v: { name: string; domainId?: number; teamId?: number | null; priority?: string; notes?: string }) {
  const domainId = v.teamId ? await teamDomain(v.teamId) : v.domainId!;
  await assertDomain(me, domainId);
  await assertPriority(v.priority);
  const cat = await loadCatalog();
  return db.transaction(async (tx) => {
    const [b] = await tx.insert(backlogItems).values({
      name: v.name, domainId, teamId: v.teamId ?? null, priority: v.priority ?? cat.defaultPriority, notes: v.notes ?? "", createdById: me.id, updatedById: me.id,
    }).returning();
    await audit(tx, me.id, "backlog", b.id, "create", { name: b.name, domainId, teamId: b.teamId }, `נוסף לבאקלוג "${b.name}"`);
    return toDTO(b);
  });
}

/**
 * עדכון: בחירת צוות קובעת גם את התחום שלו; החלפת תחום מנקה צוות שלא שייך אליו.
 * אפשר להעביר בין תחומים רק אם יש הרשאה לשניהם.
 */
export async function updateBacklog(me: Me, id: number, version: number, patch: Partial<{ name: string; domainId: number; teamId: number | null; priority: string; notes: string }>) {
  const b = await getAccessible(me, id);
  assertVersion(b, version);
  await assertPriority(patch.priority);
  const set: Partial<typeof backlogItems.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.teamId) { set.teamId = patch.teamId; set.domainId = await teamDomain(patch.teamId); }
  else if (patch.teamId === null) set.teamId = null;
  if (patch.domainId !== undefined && !patch.teamId) {
    set.domainId = patch.domainId;
    const team = set.teamId !== undefined ? set.teamId : b.teamId;
    if (team && (await teamDomain(team).catch(() => null)) !== patch.domainId) set.teamId = null;
  }
  if (set.domainId !== undefined && set.domainId !== b.domainId) await assertDomain(me, set.domainId);
  const [u] = await db.update(backlogItems).set({ ...set, version: b.version + 1, updatedAt: new Date(), updatedById: me.id })
    .where(and(eq(backlogItems.id, id), eq(backlogItems.version, version))).returning();
  if (!u) throw new ApiError(409, "הפריט עודכן בינתיים על ידי משתמש אחר.", { conflict: "version" });
  return toDTO(u);
}

export async function deleteBacklog(me: Me, id: number) {
  const b = await getAccessible(me, id);
  await db.transaction(async (tx) => {
    await tx.delete(backlogItems).where(eq(backlogItems.id, id));
    await audit(tx, me.id, "backlog", id, "delete", { name: b.name, domainId: b.domainId, teamId: b.teamId, priority: b.priority, notes: b.notes }, `נמחק מהבאקלוג "${b.name}"`);
  });
  return { ok: true };
}

/**
 * "העברה לגאנט": יוצר תכולה רגילה בשורה ובשבועות שנבחרו ומוציא את הפריט מהבאקלוג — באותה טרנזקציה,
 * כך שלא ייתכן מצב של פריט כפול (גם בגאנט וגם בבאקלוג) או של פריט שנעלם. השורה קובעת את הצוות.
 */
export async function scheduleBacklog(me: Me, id: number, version: number, input: ItemInput) {
  const b = await getAccessible(me, id);
  assertVersion(b, version);
  return db.transaction(async (tx) => {
    const del = await tx.delete(backlogItems).where(and(eq(backlogItems.id, id), eq(backlogItems.version, version))).returning({ id: backlogItems.id });
    if (!del.length) throw new ApiError(409, "הפריט עודכן או הועבר בינתיים על ידי משתמש אחר. רענן ונסה שוב.", { conflict: "version" });
    // אותו מזהה כמו בבאקלוג (שני הסוגים מקבלים מזהים מאותו מונה, כך שהוא פנוי). בודק הרשאה לשורה, חפיפה וסטטוס/תיעדוף
    const it = await createItem(me, { ...input, id: b.id }, tx);
    await audit(tx, me.id, "backlog", id, "schedule", { itemId: it.id, startWeek: it.startWeek, endWeek: it.endWeek }, `"${b.name}" הועבר מהבאקלוג לגאנט (תכולה ${it.id})`);
    return it;
  });
}
