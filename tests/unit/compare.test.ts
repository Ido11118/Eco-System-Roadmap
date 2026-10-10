import { describe, it, expect } from "vitest";
import { buildCompareLayout, buildCompareUnits, summarize, layoutLanes, mergeSegments, segmentsOverlap } from "@/lib/compare";
import type { ItemDTO, PlanData } from "@/lib/types";
import { sundayOfWeekNumber } from "@/lib/weeks";

const wk = (n: number) => sundayOfWeekNumber(2026, n);
let base: Omit<ItemDTO, "id" | "name" | "startWeek" | "endWeek"> = {
  rowId: 1, teamId: 10, status: "PLANNED", priority: "NONE", notes: "", version: 1,
  createdAt: "", createdById: 1, updatedAt: "", updatedById: 1,
};
const item = (id: number, name: string, s: number, e: number, extra: Partial<ItemDTO> = {}): ItemDTO =>
  ({ ...base, id, name, startWeek: wk(s), endWeek: wk(e), ...extra });
const plan = (items: ItemDTO[], rows = [{ id: 1, kind: "TEAM" as const, teamId: 10, sortOrder: 1, version: 1 }, { id: 2, kind: "TEAM" as const, teamId: 10, sortOrder: 2, version: 1 }]): PlanData => ({
  domains: [{ id: 1, key: "d", name: "D", sortOrder: 1, isSingleTeam: false }],
  teams: [{ id: 10, key: "t", name: "T", domainId: 1, sortOrder: 1 }],
  rows, items, milestones: [], sprints: [], users: [],
});

describe("compare by ID", () => {
  it("spec example: 101 and 102 overlap → two virtual lanes, plan+actual of each ID stay together", () => {
    const snap = plan([item(101, "תיקוני באגים", 2, 5), item(102, "ניהול מערכת", 6, 9)]);
    const cur = plan([item(101, "תיקוני באגים", 4, 7), item(102, "ניהול מערכת", 7, 10)]);
    const L = buildCompareLayout(snap, cur);
    const lanes = L.lanes.get("team:10")!;
    const row1 = lanes.filter((l) => l.rowId === 1);
    expect(row1.length).toBe(2);
    const lane101 = row1.find((l) => l.units.some((u) => u.id === 101))!;
    const lane102 = row1.find((l) => l.units.some((u) => u.id === 102))!;
    expect(lane101).not.toBe(lane102);
    // כל ID מופיע בדיוק פעם אחת
    const allIds = lanes.flatMap((l) => l.units.map((u) => u.id));
    expect(allIds.sort()).toEqual([101, 102]);
    const u101 = lane101.units.find((u) => u.id === 101)!;
    expect(u101.plan).toBeTruthy();
    expect(u101.actual).toBeTruthy();
    expect(u101.tags).toContain("delayed");
    expect(u101.startDelta).toBe(2);
    expect(u101.description).toContain("שבועיים");
  });

  it("no extra lanes when items do not overlap", () => {
    const snap = plan([item(1, "a", 1, 3), item(2, "b", 5, 8)]);
    const cur = plan([item(1, "a", 1, 3), item(2, "b", 5, 8)]);
    const L = buildCompareLayout(snap, cur);
    expect(L.lanes.get("team:10")!.filter((l) => l.rowId === 1).length).toBe(1);
  });

  it("uses the gap between non-contiguous plan/actual segments", () => {
    // ID 1: תוכנן 1-2, בפועל 9-10. ID 2: 4-6 בשתי הגרסאות -> נכנס לרווח, ללא שורה נוספת
    const snap = plan([item(1, "a", 1, 2), item(2, "b", 4, 6)]);
    const cur = plan([item(1, "a", 9, 10), item(2, "b", 4, 6)]);
    const L = buildCompareLayout(snap, cur);
    expect(L.lanes.get("team:10")!.filter((l) => l.rowId === 1).length).toBe(1);
  });

  it("matches by ID, not name; detects all cases", () => {
    const snap = plan([
      item(1, "same", 1, 2),
      item(2, "renamed old", 1, 2, { rowId: 2 }),
      item(3, "deleted", 3, 4),
      item(4, "cancel", 5, 6),
      item(5, "advance", 10, 12),
      item(6, "extend", 14, 15),
      item(7, "done", 17, 18),
    ]);
    const cur = plan([
      item(1, "same", 1, 2),
      item(2, "renamed new", 1, 2, { rowId: 2 }),
      item(4, "cancel", 5, 6, { status: "CANCELLED" }),
      item(5, "advance", 8, 10),
      item(6, "extend", 14, 17),
      item(7, "done", 17, 18, { status: "DONE" }),
      item(8, "new", 20, 21),
      item(9, "new done", 22, 23, { status: "DONE_UNPLANNED" }),
    ]);
    const U = new Map(buildCompareUnits(snap, cur).map((u) => [u.id, u]));
    expect(U.get(1)!.tags).toEqual(expect.arrayContaining(["unchanged", "notCompleted"]));
    expect(U.get(2)!.tags).toContain("renamed");
    expect(U.get(2)!.tags).toContain("unchanged");
    expect(U.get(3)!.tags).toEqual(["deleted"]);
    expect(U.get(4)!.tags).toContain("cancelled");
    expect(U.get(4)!.tags).not.toContain("deleted");
    expect(U.get(5)!.tags).toContain("advanced");
    expect(U.get(6)!.tags).toEqual(expect.arrayContaining(["delayed", "extended"]));
    expect(U.get(7)!.tags).toContain("completed");
    expect(U.get(8)!.tags).toEqual(["added"]);
    expect(U.get(9)!.tags).toEqual(expect.arrayContaining(["added", "completedUnplanned"]));
    const s = summarize([...U.values()]);
    expect(s.planned).toBe(7);
    expect(s.completed + s.notCompleted + s.cancelled + s.deleted).toBe(s.planned);
    expect(s.completed).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.deleted).toBe(1);
    expect(s.added).toBe(2);
    expect(s.completedUnplanned).toBe(1);
  });

  it("deleted items stay visible in their snapshot row, even if the row was deleted", () => {
    const snap = plan([item(1, "x", 1, 2, { rowId: 2 })]);
    const cur = plan([], [{ id: 1, kind: "TEAM", teamId: 10, sortOrder: 1, version: 1 }]);
    const L = buildCompareLayout(snap, cur);
    const lanes = L.lanes.get("team:10")!;
    expect(lanes.some((l) => l.rowId === 2 && l.units[0]?.id === 1)).toBe(true);
  });

  it("moved row: actual row preferred; plan drawn on same lane", () => {
    const snap = plan([item(1, "x", 1, 2, { rowId: 1 })]);
    const cur = plan([item(1, "x", 1, 2, { rowId: 2 })]);
    const L = buildCompareLayout(snap, cur);
    const lane = L.lanes.get("team:10")!.find((l) => l.units.length)!;
    expect(lane.rowId).toBe(2);
    expect(lane.units[0].plan && lane.units[0].actual).toBeTruthy();
  });

  it("stress: random data never splits an ID and never overlaps two IDs in a lane", () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let round = 0; round < 50; round++) {
      const p: ItemDTO[] = [], c: ItemDTO[] = [];
      for (let id = 1; id <= 40; id++) {
        const s = 1 + rnd(40), d = rnd(6);
        const row = 1 + rnd(2);
        if (rnd(5)) p.push(item(id, "p" + id, s, s + d, { rowId: row }));
        if (rnd(5)) { const s2 = Math.max(1, s + rnd(7) - 3); c.push(item(id, "c" + id, s2, s2 + rnd(6), { rowId: row })); }
      }
      const L = buildCompareLayout(plan(p), plan(c));
      const lanes = L.lanes.get("team:10")!;
      const seen = new Set<number>();
      for (const lane of lanes) {
        const segs = lane.units.map((u) => {
          const ss: [number, number][] = [];
          if (u.plan) ss.push([+u.plan.start.replaceAll("-", ""), +u.plan.end.replaceAll("-", "")]);
          if (u.actual) ss.push([+u.actual.start.replaceAll("-", ""), +u.actual.end.replaceAll("-", "")]);
          return mergeSegments(ss);
        });
        for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) expect(segmentsOverlap(segs[i], segs[j])).toBe(false);
        for (const u of lane.units) { expect(seen.has(u.id)).toBe(false); seen.add(u.id); }
      }
    }
  });

  it("layoutLanes keeps empty rows", () => {
    const l = layoutLanes<number>([], [1, 2], () => 1, () => [], (x) => x);
    expect(l.length).toBe(2);
  });
});
