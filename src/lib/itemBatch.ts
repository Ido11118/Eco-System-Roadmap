import type { ItemDTO, PlanData } from "./types";
import { addWeeks } from "./weeks";

export type BatchPatch = Partial<Pick<ItemDTO, "status" | "priority" | "startWeek" | "endWeek">>;
export type BatchEntry = { id: number; version: number; patch?: BatchPatch };
export type BatchAction = "update" | "delete" | "restore";

export function shiftedEntries(items: ItemDTO[], weeks: number): BatchEntry[] {
  return items.map((i) => ({ id: i.id, version: i.version, patch: {
    startWeek: addWeeks(i.startWeek, weeks), endWeek: addWeeks(i.endWeek, weeks),
  } }));
}

/** Check the final arrangement, excluding old positions of every selected item. */
export function batchOverlap(data: Pick<PlanData, "rows" | "items">, items: ItemDTO[]): ItemDTO | undefined {
  const ids = new Set(items.map((i) => i.id));
  const others = data.items.filter((i) => !ids.has(i.id));
  for (let n = 0; n < items.length; n++) {
    const i = items[n];
    if (data.rows.find((r) => r.id === i.rowId)?.kind !== "TEAM") continue;
    const clash = [...others, ...items.slice(0, n)].find((x) => x.rowId === i.rowId && x.startWeek <= i.endWeek && x.endWeek >= i.startWeek);
    if (clash) return clash;
  }
}
