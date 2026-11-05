import { z } from "zod";
import type { Catalog } from "./catalog";
import type { ItemDTO, PlanData, RowDTO, ViewConfig } from "./types";
import { createItemSchema, updateItemSchema } from "./validation";
import { itemMatches, timeWindow } from "@/components/plan/filters";

export const PRIVATE_TEAM = -1000000000;
export const PRIVATE_DOMAIN = -1000000000;
export const PRIVATE_NAME = "גאנט עמר";
const privateId = z.number().int().negative();
const entry = z.object({ id: privateId, version: z.number().int().positive() });
const patch = updateItemSchema.shape.patch.extend({ rowId: privateId.optional() });
export const privateCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), item: createItemSchema.innerType().extend({ rowId: privateId }).strict() }).strict(),
  z.object({ action: z.literal("update"), entries: z.array(entry.extend({ patch })).min(1).max(500) }).strict(),
  z.object({ action: z.literal("delete"), entries: z.array(entry).min(1).max(500) }).strict(),
  z.object({ action: z.literal("restore"), entries: z.array(entry).min(1).max(500) }).strict(),
  z.object({ action: z.literal("createRow"), anchorRowId: privateId.optional(), position: z.enum(["above", "below"]).optional() }).strict(),
  z.object({ action: z.literal("deleteRow"), id: privateId, version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("restoreRow"), id: privateId, version: z.number().int().positive() }).strict(),
]);
export type PrivateCommand = z.infer<typeof privateCommandSchema>;
export type PrivateState = {
  nextId: number; rows: RowDTO[]; items: ItemDTO[]; deletedItems: ItemDTO[];
  deletedRows: { row: RowDTO; itemIds: number[]; itemVersions: Record<number, number> }[];
};
export type PrivatePlan = Pick<PrivateState, "rows" | "items" | "deletedItems"> & { version: number };
export class PrivateError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function emptyPrivateState(): PrivateState {
  return { nextId: -2, rows: [{ id: -1, teamId: PRIVATE_TEAM, kind: "TEAM", sortOrder: 1000, version: 1 }], items: [], deletedItems: [], deletedRows: [] };
}
function checkVersion(item: { version: number } | undefined, version: number) {
  if (!item) throw new PrivateError(404, "התכולה או השורה הפרטית לא נמצאה");
  if (item.version !== version) throw new PrivateError(409, "הנתונים הפרטיים השתנו בינתיים. רענן ונסה שוב.");
}
function checkCatalog(cat: Catalog, p: { status?: string; priority?: string }) {
  if (p.status !== undefined && !cat.statuses.some((s) => s.key === p.status)) throw new PrivateError(400, "הסטטוס אינו זמין. רענן את הדף.");
  if (p.priority !== undefined && !cat.priorities.some((s) => s.key === p.priority)) throw new PrivateError(400, "התיעדוף אינו זמין. רענן את הדף.");
}
function validate(s: PrivateState) {
  const rows = new Set(s.rows.map((r) => r.id));
  const byRow = new Map<number, ItemDTO[]>();
  for (const i of s.items) {
    if (!rows.has(i.rowId)) throw new PrivateError(404, "השורה הפרטית לא נמצאה");
    if (i.endWeek < i.startWeek) throw new PrivateError(400, "שבוע הסיום אינו יכול להיות לפני שבוע ההתחלה");
    const others = byRow.get(i.rowId) ?? [];
    if (others.some((x) => x.startWeek <= i.endWeek && x.endWeek >= i.startWeek)) throw new PrivateError(409, "הפעולה כולה בוטלה: התכולות חופפות באותה שורה פרטית");
    others.push(i); byRow.set(i.rowId, others);
  }
}

/** Pure atomic transition. Public plan entities never enter this state. */
export function applyPrivateCommand(current: PrivateState, cmd: PrivateCommand, cat: Catalog, userId: number, now = new Date().toISOString()) {
  const s = structuredClone(current);
  let result: { items?: ItemDTO[]; row?: RowDTO } = {};
  if ("entries" in cmd && new Set(cmd.entries.map((e) => e.id)).size !== cmd.entries.length) throw new PrivateError(400, "תכולה מופיעה יותר מפעם אחת");
  const newRow = (sortOrder = Math.max(0, ...s.rows.map((r) => r.sortOrder)) + 1000) => {
    const row: RowDTO = { id: s.nextId--, teamId: PRIVATE_TEAM, kind: "TEAM", version: 1, sortOrder };
    s.rows.push(row); return row;
  };
  if (cmd.action === "create") {
    checkCatalog(cat, cmd.item);
    const i: ItemDTO = { ...cmd.item, id: s.nextId--, teamId: PRIVATE_TEAM, status: cmd.item.status ?? cat.defaultStatus,
      priority: cmd.item.priority ?? cat.defaultPriority, notes: cmd.item.notes ?? "", dependencies: cmd.item.dependencies ?? [], version: 1,
      createdAt: now, updatedAt: now, createdById: userId, updatedById: userId };
    s.items.push(i); result.items = [i];
  } else if (cmd.action === "update") {
    const changes = new Map(cmd.entries.map((e) => {
      const old = s.items.find((i) => i.id === e.id); checkVersion(old, e.version); checkCatalog(cat, e.patch);
      return [e.id, { ...old!, ...e.patch, version: old!.version + 1, updatedAt: now, updatedById: userId }];
    }));
    s.items = s.items.map((i) => changes.get(i.id) ?? i); result.items = [...changes.values()];
  } else if (cmd.action === "delete") {
    const ids = new Set(cmd.entries.map((e) => e.id));
    for (const e of cmd.entries) checkVersion(s.items.find((i) => i.id === e.id), e.version);
    result.items = s.items.filter((i) => ids.has(i.id)).map((i) => ({ ...i, version: i.version + 1, updatedAt: now, updatedById: userId }));
    s.deletedItems.push(...result.items); s.items = s.items.filter((i) => !ids.has(i.id));
  } else if (cmd.action === "restore") {
    const restored: ItemDTO[] = [];
    for (const e of cmd.entries) {
      const i = s.deletedItems.find((i) => i.id === e.id); checkVersion(i, e.version);
      const free = (id: number) => !s.items.some((x) => x.rowId === id && x.startWeek <= i!.endWeek && x.endWeek >= i!.startWeek);
      let row = s.rows.find((r) => r.id === i!.rowId && free(r.id)) ?? s.rows.find((r) => free(r.id));
      row ??= newRow();
      const r = { ...i!, rowId: row.id, version: i!.version + 1, updatedAt: now, updatedById: userId };
      s.items.push(r); restored.push(r);
    }
    const ids = new Set(cmd.entries.map((e) => e.id));
    s.deletedItems = s.deletedItems.filter((i) => !ids.has(i.id)); result.items = restored;
  } else if (cmd.action === "createRow") {
    const sorted = [...s.rows].sort((a, b) => a.sortOrder - b.sortOrder);
    const at = sorted.findIndex((r) => r.id === cmd.anchorRowId);
    if (cmd.anchorRowId !== undefined && at < 0) throw new PrivateError(404, "השורה הפרטית לא נמצאה");
    const pos = cmd.position === "above" ? at : at + 1;
    const so = at < 0 ? undefined : pos === 0 ? sorted[0].sortOrder - 1000 : pos === sorted.length ? sorted.at(-1)!.sortOrder + 1000 : (sorted[pos - 1].sortOrder + sorted[pos].sortOrder) / 2;
    result.row = newRow(so);
  } else if (cmd.action === "deleteRow") {
    const row = s.rows.find((r) => r.id === cmd.id); checkVersion(row, cmd.version);
    if (s.rows.length === 1) throw new PrivateError(400, "יש להשאיר לפחות שורה אחת בגאנט עמר. אפשר למחוק את התכולות שבה.");
    const items = s.items.filter((i) => i.rowId === cmd.id).map((i) => ({ ...i, version: i.version + 1, updatedAt: now, updatedById: userId }));
    s.deletedItems.push(...items); s.items = s.items.filter((i) => i.rowId !== cmd.id);
    s.rows = s.rows.filter((r) => r.id !== cmd.id);
    result.row = { ...row!, version: row!.version + 1 };
    s.deletedRows.push({ row: result.row, itemIds: items.map((i) => i.id), itemVersions: Object.fromEntries(items.map((i) => [i.id, i.version])) });
  } else if (cmd.action === "restoreRow") {
    const removed = s.deletedRows.find((r) => r.row.id === cmd.id); checkVersion(removed?.row, cmd.version);
    if (s.rows.some((r) => r.id === cmd.id) || removed!.itemIds.some((id) => !s.deletedItems.some((i) => i.id === id && i.version === removed!.itemVersions[id]))) throw new PrivateError(409, "השורה או התכולות שוחזרו מאז — לא ניתן לבטל את הפעולה כולה");
    result.row = { ...removed!.row, version: removed!.row.version + 1 }; s.rows.push(result.row);
    const ids = new Set(removed!.itemIds);
    s.items.push(...s.deletedItems.filter((i) => ids.has(i.id)).map((i) => ({ ...i, version: i.version + 1, updatedAt: now, updatedById: userId })));
    s.deletedItems = s.deletedItems.filter((i) => !ids.has(i.id)); s.deletedRows = s.deletedRows.filter((r) => r.row.id !== cmd.id);
  }
  validate(s);
  return { state: s, result };
}

export function withPrivateWorkspace(plan: PlanData, workspace: PrivatePlan, view: ViewConfig): PlanData {
  const window = view.time.kind === "all" ? undefined : timeWindow(view.time, plan);
  return { ...plan,
    domains: [{ id: PRIVATE_DOMAIN, key: "private-omar", name: PRIVATE_NAME, sortOrder: -1e9, isSingleTeam: true }, ...plan.domains],
    teams: [{ id: PRIVATE_TEAM, key: "private-omar", name: PRIVATE_NAME, domainId: PRIVATE_DOMAIN, sortOrder: -1e9 }, ...plan.teams],
    rows: [...workspace.rows, ...plan.rows], items: [...workspace.items.filter((i) => itemMatches(i, view, window)), ...plan.items] };
}
