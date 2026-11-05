import { describe, expect, it } from "vitest";
import { personalGanttPlan } from "../../src/lib/personalGantt";
import { defaultViewConfig } from "../../src/components/plan/filters";
import type { PlanData } from "../../src/lib/types";

const plan = {
  items: [
    { id: 1, rowId: 10, teamId: 20, name: "selected", status: "OPEN", priority: "HIGH", startWeek: "2026-11-01", endWeek: "2026-11-08", notes: "" },
    { id: 2, rowId: 11, teamId: 20, name: "other", status: "OPEN", priority: "HIGH", startWeek: "2026-11-01", endWeek: "2026-11-01", notes: "" },
    { id: 3, rowId: 12, teamId: null, name: "cross", status: "OPEN", priority: "HIGH", startWeek: "2026-11-01", endWeek: "2026-11-01", notes: "" },
  ],
  rows: [{ id: 10, teamId: 20, kind: "TEAM" }, { id: 11, teamId: 20, kind: "TEAM" }, { id: 12, teamId: null, kind: "INFLUENCE" }, { id: 13, teamId: 21, kind: "TEAM" }],
  teams: [{ id: 20, domainId: 30 }, { id: 21, domainId: 31 }], domains: [{ id: 30 }, { id: 31 }],
  milestones: [{ id: 1 }], sprints: [{ id: 1 }], users: [],
} as unknown as PlanData;
const view = defaultViewConfig();

describe("private Gantt projection", () => {
  it("keeps only selected live items, their rows, teams and domains", () => {
    const result = personalGanttPlan(plan, [1, 999], false, view);
    expect(result.items.map((i) => i.id)).toEqual([1]);
    expect(result.rows.map((r) => r.id)).toEqual([10]);
    expect(result.teams.map((t) => t.id)).toEqual([20]);
    expect(result.domains.map((d) => d.id)).toEqual([30]);
    expect(result.milestones).toEqual([]); expect(result.sprints).toEqual([]);
    expect(result.items[0]).toBe(plan.items[0]);
  });
  it("shows source items once in the full original structure", () => {
    const result = personalGanttPlan(plan, [1], true, view);
    expect(result.items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(result.rows).toBe(plan.rows);
    expect(result.milestones).toEqual([]); expect(result.sprints).toEqual([]);
  });
  it("supports cross rows without introducing empty teams or domains", () => {
    const result = personalGanttPlan(plan, [3], false, view);
    expect(result.rows.map((r) => r.id)).toEqual([12]);
    expect(result.teams).toEqual([]); expect(result.domains).toEqual([]);
  });
  it("compacts after search and date filtering without mutating the plan", () => {
    expect(personalGanttPlan(plan, [1, 2], false, { ...view, search: "other" }).rows.map((r) => r.id)).toEqual([11]);
    expect(personalGanttPlan(plan, [1], false, { ...view, time: { kind: "dates", from: "2027-01-01", to: "2027-02-01" } }).items).toEqual([]);
    expect(plan.rows).toHaveLength(4); expect(plan.items).toHaveLength(3);
  });
  it("never copies stale item values and keeps restored IDs selected", () => {
    const deleted = { ...plan, items: plan.items.filter((i) => i.id !== 1) };
    expect(personalGanttPlan(deleted, [1], false, view).items).toEqual([]);
    const changed = { ...plan, items: plan.items.map((i) => i.id === 1 ? { ...i, name: "new source name", rowId: 11 } : i) };
    expect(personalGanttPlan(changed, [1], false, view).items[0].name).toBe("new source name");
    expect(personalGanttPlan(changed, [1], false, view).rows[0].id).toBe(11);
  });
  it("follows a selected item into a different team and domain", () => {
    const moved = { ...plan, items: plan.items.map((i) => i.id === 1 ? { ...i, rowId: 13, teamId: 21 } : i) };
    const result = personalGanttPlan(moved, [1], false, view);
    expect(result.rows.map((r) => r.id)).toEqual([13]);
    expect(result.teams.map((t) => t.id)).toEqual([21]);
    expect(result.domains.map((d) => d.id)).toEqual([31]);
  });
  it("honors team/domain filters and does not leave empty cross rows", () => {
    expect(personalGanttPlan(plan, [1, 3], false, { ...view, domainIds: [31] }).items).toEqual([]);
    expect(personalGanttPlan(plan, [1], false, { ...view, teamIds: [21] }).rows).toEqual([]);
  });
});
