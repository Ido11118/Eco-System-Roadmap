// בדיקות רגרסיה לממצאי סקירת הקוד
import { describe, it, expect } from "vitest";
import { classify, buildCompareUnits, summarize, layoutLanes } from "@/lib/compare";
import { shiftTime, timeWindow, itemMatches, defaultViewConfig } from "@/components/plan/filters";
import { sundaysInRange, periodWeeksWindow, sundayOfWeekNumber } from "@/lib/weeks";
import type { ItemDTO, PlanData } from "@/lib/types";

const wk = (n: number) => sundayOfWeekNumber(2026, n);
const item = (id: number, s: number, e: number, extra: Partial<ItemDTO> = {}): ItemDTO => ({
  id, name: `i${id}`, rowId: 1, teamId: 10, startWeek: wk(s), endWeek: wk(e), status: "PLANNED", priority: "NONE", notes: "",
  version: 1, createdAt: "", createdById: 1, updatedAt: "", updatedById: 1, ...extra,
});
const plan = (items: ItemDTO[]): PlanData => ({
  domains: [{ id: 1, key: "d", name: "D", sortOrder: 1, isSingleTeam: false }],
  teams: [{ id: 10, key: "t", name: "T", domainId: 1, sortOrder: 1 }],
  rows: [{ id: 1, kind: "TEAM", teamId: 10, sortOrder: 1, version: 1 }, { id: 2, kind: "INFLUENCE", teamId: null, sortOrder: 0, version: 1 }],
  items, milestones: [], sprints: [], users: [],
});

describe("classify — every matched item gets exactly one timing category", () => {
  const timing = (t: string[]) => t.filter((x) => ["unchanged", "delayed", "advanced"].includes(x));
  it("start later, end earlier → advanced + shortened", () => {
    const c = classify(item(1, 2, 10), item(1, 4, 8));
    expect(timing(c.tags)).toEqual(["advanced"]);
    expect(c.tags).toContain("shortened");
  });
  it("start earlier, end later → delayed + extended", () => {
    const c = classify(item(1, 4, 8), item(1, 2, 10));
    expect(timing(c.tags)).toEqual(["delayed"]);
    expect(c.tags).toContain("extended");
  });
  it("cancelled with same dates keeps 'unchanged' and is also cancelled", () => {
    const c = classify(item(1, 2, 3), item(1, 2, 3, { status: "CANCELLED" }));
    expect(c.tags).toEqual(expect.arrayContaining(["unchanged", "cancelled"]));
  });
  it("planned item later marked DONE_UNPLANNED is completed, not 'completed unplanned'", () => {
    const c = classify(item(1, 2, 3), item(1, 2, 3, { status: "DONE_UNPLANNED" }));
    expect(c.tags).toContain("completed");
    expect(c.tags).not.toContain("completedUnplanned");
  });
});

describe("summary baseline membership uses the snapshot row", () => {
  it("item moved from team row to cross row still counts as planned", () => {
    const s = summarize(buildCompareUnits(plan([item(5, 2, 3)]), plan([item(5, 2, 3, { rowId: 2, teamId: null })])));
    expect(s.planned).toBe(1);
  });
});

describe("layoutLanes never drops units", () => {
  it("empty rowOrder", () => {
    const l = layoutLanes([1, 2], [], () => 7, (x) => [[x, x]], (x) => x);
    expect(l.flatMap((x) => x.units).sort()).toEqual([1, 2]);
  });
});

describe("time windows follow the Sunday rule", () => {
  it("year 2027 excludes week 52 of 2026", () => {
    const [f, t] = timeWindow({ kind: "year", year: 2027 });
    expect(f).toBe("2027-01-03");
    expect(t).toBe("2028-01-01");
    const it52 = item(1, 52, 52);
    expect(itemMatches(it52, defaultViewConfig(), [f, t])).toBe(false);
  });
  it("quarter window", () => {
    expect(timeWindow({ kind: "quarter", year: 2026, q: 4 })).toEqual(["2026-10-04", "2027-01-02"]);
  });
  it("sundaysInRange returns null when no Sunday in range", () => {
    expect(sundaysInRange("2026-10-05", "2026-10-09")).toBeNull();
    expect(periodWeeksWindow("2026-10-05", "2026-10-09")).toEqual(["2026-10-04", "2026-10-10"]);
  });
});

describe("shiftTime", () => {
  it("multi-month range shifts by its own length", () => {
    expect(shiftTime({ kind: "dates", from: "2026-01-01", to: "2026-03-31" }, 1)).toEqual({ kind: "dates", from: "2026-04-01", to: "2026-06-30" });
    expect(shiftTime({ kind: "dates", from: "2026-01-01", to: "2026-12-31" }, -1)).toEqual({ kind: "dates", from: "2025-01-01", to: "2025-12-31" });
    expect(shiftTime({ kind: "dates", from: "2026-12-01", to: "2026-12-31" }, 1)).toEqual({ kind: "dates", from: "2027-01-01", to: "2027-01-31" });
  });
  it("custom range shifts by exact length, no overlap/gap; reversed range normalized", () => {
    expect(shiftTime({ kind: "dates", from: "2026-10-01", to: "2026-10-10" }, 1)).toEqual({ kind: "dates", from: "2026-10-11", to: "2026-10-20" });
    expect(shiftTime({ kind: "dates", from: "2026-10-10", to: "2026-10-01" }, -1)).toEqual({ kind: "dates", from: "2026-09-21", to: "2026-09-30" });
  });
  it("quarter wraps years", () => {
    expect(shiftTime({ kind: "quarter", year: 2026, q: 4 }, 1)).toEqual({ kind: "quarter", year: 2027, q: 1 });
  });
});
