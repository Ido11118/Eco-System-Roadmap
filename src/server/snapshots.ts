import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { snapshots, snapshotRevisions, users } from "@/db/schema";
import type { Me, PlanData, SnapshotMeta } from "@/lib/types";
import { ApiError } from "./errors";
import { audit, loadPlan } from "./plan";

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const rows = await db.select({
    s: snapshots,
    createdBy: users.fullName,
    revNo: snapshotRevisions.revisionNo,
    revCount: sql<number>`(select count(*)::int from snapshot_revisions r where r.snapshot_id = ${snapshots.id})`,
  }).from(snapshots)
    .leftJoin(users, eq(users.id, snapshots.createdById))
    .leftJoin(snapshotRevisions, eq(snapshotRevisions.id, snapshots.currentRevisionId))
    .where(isNull(snapshots.deletedAt))
    .orderBy(desc(snapshots.createdAt));
  return rows.map((r) => ({
    id: r.s.id, name: r.s.name, description: r.s.description, createdAt: r.s.createdAt.toISOString(),
    createdBy: r.createdBy ?? "", currentRevisionId: r.s.currentRevisionId!, currentRevisionNo: r.revNo ?? 1,
    revisionCount: r.revCount,
  }));
}

/** יצירת Snapshot: עותק מלא ועקבי (טרנזקציה REPEATABLE READ) של התוכנית הנוכחית. התוכנית עצמה אינה משתנה. */
export async function createSnapshot(me: Me, name: string, description: string) {
  return db.transaction(async (tx) => {
    const data = await loadPlan(tx);
    const [s] = await tx.insert(snapshots).values({ name, description, createdById: me.id }).returning();
    const [rev] = await tx.insert(snapshotRevisions).values({
      snapshotId: s.id, revisionNo: 1, data, note: "גרסה מקורית", createdById: me.id,
    }).returning();
    await tx.update(snapshots).set({ currentRevisionId: rev.id }).where(eq(snapshots.id, s.id));
    await audit(tx, me.id, "snapshot", s.id, "create", { name, items: data.items.length }, `נוצר Snapshot "${name}"`);
    return { id: s.id, revisionId: rev.id };
  }, { isolationLevel: "repeatable read" });
}

export async function getSnapshotRevision(snapshotId: number, revisionId?: number) {
  const [s] = await db.select().from(snapshots).where(and(eq(snapshots.id, snapshotId), isNull(snapshots.deletedAt)));
  if (!s) throw new ApiError(404, "ה-Snapshot לא נמצא");
  const revId = revisionId ?? s.currentRevisionId!;
  const [rev] = await db.select().from(snapshotRevisions)
    .where(and(eq(snapshotRevisions.id, revId), eq(snapshotRevisions.snapshotId, snapshotId)));
  if (!rev) throw new ApiError(404, "הגרסה לא נמצאה");
  return {
    snapshot: { id: s.id, name: s.name, description: s.description, currentRevisionId: s.currentRevisionId },
    revision: { id: rev.id, revisionNo: rev.revisionNo, note: rev.note, createdAt: rev.createdAt.toISOString() },
    data: rev.data as PlanData,
  };
}

export async function listRevisions(snapshotId: number) {
  const [snap] = await db.select({ id: snapshots.id }).from(snapshots).where(and(eq(snapshots.id, snapshotId), isNull(snapshots.deletedAt)));
  if (!snap) throw new ApiError(404, "ה-Snapshot לא נמצא");
  const rows = await db.select({
    id: snapshotRevisions.id, revisionNo: snapshotRevisions.revisionNo, note: snapshotRevisions.note,
    createdAt: snapshotRevisions.createdAt, createdBy: users.fullName,
    items: sql<number>`jsonb_array_length(${snapshotRevisions.data}->'items')`,
  }).from(snapshotRevisions).leftJoin(users, eq(users.id, snapshotRevisions.createdById))
    .where(eq(snapshotRevisions.snapshotId, snapshotId)).orderBy(desc(snapshotRevisions.revisionNo));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

async function nextIds(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], seq: string, n: number): Promise<number[]> {
  if (!n) return [];
  const r = await tx.execute(sql`SELECT nextval(${seq}::regclass)::int AS id FROM generate_series(1, ${n})`);
  return r.rows.map((x) => Number((x as { id: number }).id));
}

/**
 * עריכת Snapshot = יצירת Revision חדש. הגרסאות הקודמות לעולם אינן משתנות.
 * פריטים חדשים שנוספו בעריכה (מזהה שלילי) מקבלים מזהה קבוע מאותו רצף של התוכנית החיה, כדי שלא יתנגשו בהשוואה.
 */
export async function saveRevision(me: Me, snapshotId: number, baseRevisionId: number, note: string, data: PlanData) {
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT current_revision_id FROM snapshots WHERE id = ${snapshotId} AND deleted_at IS NULL FOR UPDATE`);
    if (!lock.rows.length) throw new ApiError(404, "ה-Snapshot לא נמצא");
    const currentRev = Number((lock.rows[0] as { current_revision_id: number }).current_revision_id);
    if (currentRev !== baseRevisionId) {
      throw new ApiError(409, "ה-Snapshot עודכן בינתיים (נוצרה גרסה חדשה). טען מחדש ונסה שוב.", { conflict: "version" });
    }
    // --- אימות שלמות הנתונים לפני שמירה ---
    const prev = (await tx.execute(sql`SELECT data FROM snapshot_revisions WHERE snapshot_id = ${snapshotId} ORDER BY revision_no`)).rows as { data: PlanData }[];
    const base = prev.find((r, i) => i === prev.length - 1)?.data;
    if (!base) throw new ApiError(404, "ה-Snapshot לא נמצא");
    // מבנה ארגוני ומשתמשים נלקחים מהגרסה הקיימת ולא מהלקוח
    data.domains = base.domains;
    data.teams = base.teams;
    data.users = base.users;
    validateRevisionData(data, prev.map((r) => r.data));
    // הקצאת מזהים קבועים לישויות חדשות
    const fix = async <T extends { id: number }>(arr: T[], seq: string) => {
      const neg = arr.filter((x) => x.id <= 0);
      const ids = await nextIds(tx, seq, neg.length);
      const map = new Map<number, number>();
      neg.forEach((x, i) => { map.set(x.id, ids[i]); x.id = ids[i]; });
      return map;
    };
    const rowMap = await fix(data.rows, "work_rows_id_seq");
    for (const it of data.items) if (rowMap.has(it.rowId)) it.rowId = rowMap.get(it.rowId)!;
    await fix(data.items, "work_items_id_seq");
    await fix(data.milestones, "milestones_id_seq");
    await fix(data.sprints, "sprints_id_seq");
    // שלמות: כל תכולה משויכת לשורה קיימת ב-Snapshot
    const rowIds = new Map(data.rows.map((r) => [r.id, r]));
    for (const it of data.items) {
      const r = rowIds.get(it.rowId);
      if (!r) throw new ApiError(400, `התכולה "${it.name}" משויכת לשורה שאינה קיימת`);
      it.teamId = r.teamId;
    }
    const [{ max }] = (await tx.execute(sql`SELECT coalesce(max(revision_no),0)::int AS max FROM snapshot_revisions WHERE snapshot_id = ${snapshotId}`)).rows as { max: number }[];
    const [rev] = await tx.insert(snapshotRevisions).values({
      snapshotId, revisionNo: Number(max) + 1, data, note: note || "עריכה", createdById: me.id,
    }).returning();
    await tx.update(snapshots).set({ currentRevisionId: rev.id }).where(eq(snapshots.id, snapshotId));
    await audit(tx, me.id, "snapshot", snapshotId, "revise", { revisionNo: rev.revisionNo, note }, `נשמרה גרסה ${rev.revisionNo} של Snapshot`);
    return { revisionId: rev.id, revisionNo: rev.revisionNo };
  });
}

/** שחזור גרסה קודמת = יצירת Revision חדש עם תוכן הגרסה הישנה (ההיסטוריה נשמרת במלואה) */
export async function restoreRevision(me: Me, snapshotId: number, revisionId: number) {
  const { data, revision, snapshot } = await getSnapshotRevision(snapshotId, revisionId);
  return saveRevision(me, snapshotId, snapshot.currentRevisionId!, `שחזור מגרסה ${revision.revisionNo}`, data);
}

export async function updateSnapshotMeta(me: Me, id: number, patch: { name?: string; description?: string }) {
  const [s] = await db.update(snapshots).set(patch).where(and(eq(snapshots.id, id), isNull(snapshots.deletedAt))).returning();
  if (!s) throw new ApiError(404, "ה-Snapshot לא נמצא");
  await audit(db, me.id, "snapshot", id, "update", patch, "עודכנו פרטי Snapshot");
  return { ok: true };
}

export async function deleteSnapshot(me: Me, id: number) {
  const [s] = await db.update(snapshots).set({ deletedAt: new Date() }).where(and(eq(snapshots.id, id), isNull(snapshots.deletedAt))).returning();
  if (!s) throw new ApiError(404, "ה-Snapshot לא נמצא");
  await audit(db, me.id, "snapshot", id, "delete", null, `נמחק Snapshot "${s.name}"`);
  return { ok: true };
}


/** כללי תקינות לתוכן Snapshot — אותם כללים כמו בתוכנית החיה */
function validateRevisionData(data: PlanData, history: PlanData[]) {
  const teamIds = new Set(data.teams.map((t) => t.id));
  const collections = [["rows", "שורות"], ["items", "תכולות"], ["milestones", "אבני דרך"], ["sprints", "ספרינטים"]] as const;
  for (const [key, label] of collections) {
    const arr = data[key] as { id: number }[];
    const ids = arr.map((x) => x.id);
    if (new Set(ids).size !== ids.length) throw new ApiError(400, `מזהים כפולים ב${label}`);
    // מזהה חיובי חייב להיות מזהה שכבר הופיע ב-Snapshot זה (אחרת ההשוואה עלולה להתאים לתכולה לא קשורה)
    const known = new Set(history.flatMap((h) => (h[key] as { id: number }[]).map((x) => x.id)));
    const bad = arr.find((x) => x.id > 0 && !known.has(x.id));
    if (bad) throw new ApiError(400, `מזהה לא מוכר ב${label}: ${bad.id}. ישויות חדשות חייבות להישלח עם מזהה שלילי.`);
  }
  for (const r of data.rows) {
    if (r.kind === "TEAM" ? !(r.teamId !== null && teamIds.has(r.teamId)) : r.teamId !== null) throw new ApiError(400, "שורה עם שיוך צוות לא תקין");
  }
  for (const m of data.milestones) if (m.teamId !== null && !teamIds.has(m.teamId)) throw new ApiError(400, `אבן הדרך "${m.name}" משויכת לצוות לא קיים`);
  for (const sp of data.sprints) {
    if (!teamIds.has(sp.teamId)) throw new ApiError(400, `הספרינט "${sp.name}" משויך לצוות לא קיים`);
    if (sp.endDate < sp.startDate) throw new ApiError(400, `תאריכי הספרינט "${sp.name}" אינם תקינים`);
  }
  const rowKind = new Map(data.rows.map((r) => [r.id, r.kind]));
  const byRow = new Map<number, PlanData["items"]>();
  for (const it of data.items) {
    if (!rowKind.has(it.rowId)) throw new ApiError(400, `התכולה "${it.name}" משויכת לשורה שאינה קיימת`);
    if (rowKind.get(it.rowId) !== "TEAM") continue;
    if (!byRow.has(it.rowId)) byRow.set(it.rowId, []);
    byRow.get(it.rowId)!.push(it);
  }
  for (const list of byRow.values()) {
    list.sort((a, b) => a.startWeek.localeCompare(b.startWeek));
    for (let i = 1; i < list.length; i++) {
      if (list[i].startWeek <= list[i - 1].endWeek) throw new ApiError(400, `התכולות "${list[i - 1].name}" ו-"${list[i].name}" חופפות באותה שורה`);
    }
  }
}
