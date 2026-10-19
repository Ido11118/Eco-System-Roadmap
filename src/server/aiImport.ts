import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { backlogItems, domains, milestones, sprints, teams, workItems, workRows } from "@/db/schema";
import type { Me } from "@/lib/types";
import { CROSS_LABEL, placeTeamItems, type ImportPayload, type ImportResult } from "@/lib/aiImport";
import { ApiError } from "./errors";
import { loadCatalog } from "./catalog";
import { audit, canEditCross, rowToDTO } from "./plan";

const isSuper = (me: Me) => me.role === "SUPER";

/**
 * ייבוא בעזרת AI: יוצר את כל התכולות, אבני הדרך והספרינטים בטרנזקציה אחת (הכל או כלום).
 * אותם כללים כמו ביצירה רגילה: הרשאה לפי תחום / רוחבי, ערכים מהקטלוג, ללא חפיפה בשורת צוות.
 * תכולות צוות משובצות אוטומטית בשורה הראשונה הפנויה, ואם אין — נוצרת שורה חדשה.
 */
export async function importPlan(me: Me, p: ImportPayload): Promise<ImportResult> {
  const cat = await loadCatalog();
  const [ts, ds] = await Promise.all([db.select().from(teams).where(isNull(teams.archivedAt)), db.select().from(domains)]);
  const teamDomain = new Map(ts.map((t) => [t.id, t.domainId]));
  const domainName = new Map(ds.map((d) => [d.id, d.name]));
  const canTeam = (teamId: number) => teamDomain.has(teamId) && (isSuper(me) || me.domainIds.includes(teamDomain.get(teamId)!));

  // בדיקה מלאה לפני שנוגעים בנתונים — כך המשתמש מקבל את כל הבעיות בבת אחת
  const errors: string[] = [];
  const team = (name: string, teamId: number | null, crossLabel: string) => {
    if (teamId === null) { if (!canEditCross(me)) errors.push(`"${name}": אין לך הרשאת עריכה ל${crossLabel}`); return; }
    if (!teamDomain.has(teamId)) errors.push(`"${name}": הצוות לא קיים`);
    else if (!canTeam(teamId)) errors.push(`"${name}": אין לך הרשאת עריכה לתחום "${domainName.get(teamDomain.get(teamId)!)}"`);
  };
  for (const i of p.items) {
    team(i.name, i.teamId, i.cross ? CROSS_LABEL[i.cross] : "מידע הרוחבי");
    if (i.status && !cat.statuses.some((s) => s.key === i.status)) errors.push(`"${i.name}": סטטוס לא קיים`);
    if (i.priority && !cat.priorities.some((x) => x.key === i.priority)) errors.push(`"${i.name}": תיעדוף לא קיים`);
  }
  const domain = (name: string, domainId: number) => {
    if (!domainName.has(domainId)) errors.push(`"${name}": התחום לא קיים`);
    else if (!isSuper(me) && !me.domainIds.includes(domainId)) errors.push(`"${name}": אין לך הרשאת עריכה לתחום "${domainName.get(domainId)}"`);
  };
  for (const m of p.milestones) {
    if (m.teamId === null && m.domainId !== null) domain(m.name, m.domainId); // אבן דרך לכל התחום
    else team(m.name, m.teamId, "אבני דרך רוחביות");
  }
  for (const s of p.sprints) domain(s.name, s.domainId);
  for (const b of p.backlog) { // באקלוג: הרשאה לתחום; צוות (לא חובה) חייב להיות מאותו תחום
    domain(b.name, b.domainId);
    if (b.teamId !== null && teamDomain.get(b.teamId) !== b.domainId) errors.push(`"${b.name}": הצוות לא קיים או לא שייך לתחום`);
    if (b.priority && !cat.priorities.some((x) => x.key === b.priority)) errors.push(`"${b.name}": תיעדוף לא קיים`);
  }
  if (errors.length) throw new ApiError(403, `לא ניתן לייבא: ${errors.slice(0, 5).join(" · ")}${errors.length > 5 ? ` (ועוד ${errors.length - 5})` : ""}`, { errors });

  return db.transaction(async (tx) => {
    const teamItems = p.items.filter((i) => i.teamId !== null) as (ImportPayload["items"][number] & { teamId: number })[];
    const teamIds = [...new Set(teamItems.map((i) => i.teamId))];
    // נעילת שורות הצוותים: מונעת שיבוץ מקבילי (משתמש אחר שמוסיף תכולה לאותה שורה בדיוק עכשיו)
    if (teamIds.length) await tx.select({ id: workRows.id }).from(workRows).where(and(inArray(workRows.teamId, teamIds), isNull(workRows.deletedAt))).for("update");
    const rows = (await tx.select().from(workRows).where(isNull(workRows.deletedAt))).map(rowToDTO);
    const live = teamIds.length
      ? await tx.select({ rowId: workItems.rowId, startWeek: workItems.startWeek, endWeek: workItems.endWeek }).from(workItems)
        .where(and(inArray(workItems.teamId, teamIds), isNull(workItems.deletedAt)))
      : [];
    const places = placeTeamItems(rows, live, teamItems);

    const out: ImportResult = { itemIds: [], milestoneIds: [], sprintIds: [], rowIds: [], backlogIds: [] };
    const newRows = new Map<string, number>();
    const rowFor = async (teamId: number, k: number) => {
      const key = `${teamId}:${k}`;
      if (!newRows.has(key)) {
        const last = Math.max(0, ...rows.filter((r) => r.kind === "TEAM" && r.teamId === teamId).map((r) => r.sortOrder));
        const [row] = await tx.insert(workRows).values({ kind: "TEAM", teamId, sortOrder: last + 1000 * (k + 1), createdById: me.id }).returning();
        await audit(tx, me.id, "row", row.id, "create", { teamId, import: "ai" }, "נוספה שורה (ייבוא בעזרת AI)");
        newRows.set(key, row.id); out.rowIds.push(row.id);
      }
      return newRows.get(key)!;
    };
    const crossRow = (kind: string) => {
      const r = rows.find((x) => x.kind === kind);
      if (!r) throw new ApiError(500, "השורה הרוחבית לא נמצאה");
      return r.id;
    };

    let ti = 0;
    for (const i of p.items) {
      let rowId: number;
      if (i.teamId === null) rowId = crossRow(i.cross!);
      else { const pl = places[ti++]; rowId = "rowId" in pl ? pl.rowId : await rowFor(i.teamId, pl.newRow); }
      const [it] = await tx.insert(workItems).values({
        name: i.name, rowId, teamId: i.teamId, startWeek: i.startWeek, endWeek: i.endWeek,
        status: i.status ?? cat.defaultStatus, priority: i.priority ?? cat.defaultPriority, notes: i.notes,
        createdById: me.id, updatedById: me.id,
      }).returning();
      await audit(tx, me.id, "item", it.id, "create", { name: it.name, startWeek: it.startWeek, endWeek: it.endWeek, status: it.status, import: "ai" }, `נוצרה תכולה "${it.name}" (ייבוא בעזרת AI)`);
      out.itemIds.push(it.id);
    }
    for (const m of p.milestones) {
      const [r] = await tx.insert(milestones).values({ ...m, createdById: me.id, updatedById: me.id }).returning();
      await audit(tx, me.id, "milestone", r.id, "create", { name: r.name, date: r.date, import: "ai" }, `נוצרה אבן דרך "${r.name}" (ייבוא בעזרת AI)`);
      out.milestoneIds.push(r.id);
    }
    for (const s of p.sprints) {
      const [r] = await tx.insert(sprints).values({ ...s, createdById: me.id, updatedById: me.id }).returning();
      await audit(tx, me.id, "sprint", r.id, "create", { name: r.name, import: "ai" }, `נוצר ספרינט "${r.name}" (ייבוא בעזרת AI)`);
      out.sprintIds.push(r.id);
    }
    for (const b of p.backlog) {
      const [r] = await tx.insert(backlogItems).values({
        name: b.name, domainId: b.domainId, teamId: b.teamId, priority: b.priority ?? cat.defaultPriority, notes: b.notes, createdById: me.id, updatedById: me.id,
      }).returning();
      await audit(tx, me.id, "backlog", r.id, "create", { name: r.name, domainId: r.domainId, teamId: r.teamId, import: "ai" }, `נוסף לבאקלוג "${r.name}" (ייבוא בעזרת AI)`);
      out.backlogIds.push(r.id);
    }
    await audit(tx, me.id, "import", "ai", "create", out, `ייבוא בעזרת AI: ${out.itemIds.length} תכולות, ${out.milestoneIds.length} אבני דרך, ${out.sprintIds.length} ספרינטים, ${out.backlogIds.length} פריטי באקלוג`);
    return out;
  });
}

/**
 * ביטול ייבוא: מוחק (Soft Delete) רק את מה שהמשתמש עצמו יצר בייבוא ולא נערך מאז (version = 1),
 * ושורות שנוצרו בייבוא ונשארו ריקות. מה שנערך בינתיים — נשאר, ומדווח.
 */
export async function undoImport(me: Me, ids: ImportResult) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const pickIds = (list: number[]) => (list.length ? list : [-1]);
    const items = await tx.update(workItems).set({ deletedAt: now, deletedById: me.id })
      .where(and(inArray(workItems.id, pickIds(ids.itemIds)), eq(workItems.createdById, me.id), eq(workItems.version, 1), isNull(workItems.deletedAt))).returning({ id: workItems.id });
    const ms = await tx.update(milestones).set({ deletedAt: now })
      .where(and(inArray(milestones.id, pickIds(ids.milestoneIds)), eq(milestones.createdById, me.id), eq(milestones.version, 1), isNull(milestones.deletedAt))).returning({ id: milestones.id });
    const sp = await tx.update(sprints).set({ deletedAt: now })
      .where(and(inArray(sprints.id, pickIds(ids.sprintIds)), eq(sprints.createdById, me.id), eq(sprints.version, 1), isNull(sprints.deletedAt))).returning({ id: sprints.id });
    // באקלוג: מחיקה (אין מחיקה רכה) רק של מה שלא נערך ולא הועבר לגאנט מאז
    const bl = await tx.delete(backlogItems)
      .where(and(inArray(backlogItems.id, pickIds(ids.backlogIds ?? [])), eq(backlogItems.createdById, me.id), eq(backlogItems.version, 1))).returning({ id: backlogItems.id });
    let rowsDeleted = 0;
    for (const rowId of ids.rowIds) {
      const [any] = await tx.select({ id: workItems.id }).from(workItems).where(and(eq(workItems.rowId, rowId), isNull(workItems.deletedAt))).limit(1);
      if (any) continue;
      const r = await tx.update(workRows).set({ deletedAt: now, deletedById: me.id })
        .where(and(eq(workRows.id, rowId), eq(workRows.createdById, me.id), isNull(workRows.deletedAt))).returning({ id: workRows.id });
      rowsDeleted += r.length;
    }
    const removed = items.length + ms.length + sp.length + bl.length;
    const skipped = ids.itemIds.length + ids.milestoneIds.length + ids.sprintIds.length + (ids.backlogIds ?? []).length - removed;
    await audit(tx, me.id, "import", "ai", "delete", { itemIds: items.map((x) => x.id), milestoneIds: ms.map((x) => x.id), sprintIds: sp.map((x) => x.id), backlogIds: bl.map((x) => x.id), rowsDeleted },
      `בוטל ייבוא בעזרת AI (${removed} פריטים${skipped ? `, ${skipped} נערכו בינתיים ונשארו` : ""})`);
    return { removed, skipped };
  });
}
