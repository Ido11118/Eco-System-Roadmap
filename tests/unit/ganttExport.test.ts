import { describe, it, expect } from "vitest";
import { buildExportModel, defaultDomainIds, exportFileName, fullRange } from "@/components/gantt/export/model";
import { defaultViewConfig, CROSS_FILTER } from "@/components/plan/filters";
import type { ItemDTO, MilestoneDTO, PlanData, SprintDTO } from "@/lib/types";

const base = { version: 1, createdAt: "", createdById: null, updatedAt: "", updatedById: null };
const item = (id: number, rowId: number, teamId: number | null, startWeek: string, endWeek: string, extra: Partial<ItemDTO> = {}): ItemDTO =>
  ({ ...base, id, name: `item ${id}`, rowId, teamId, startWeek, endWeek, status: "PLANNED", priority: "NONE", notes: "", ...extra });
const ms = (id: number, date: string, teamId: number | null, domainId: number | null): MilestoneDTO =>
  ({ ...base, id, name: `ms ${id}`, date, teamId, domainId, notes: "" });
const sprint = (id: number, domainId: number, startDate: string, endDate: string): SprintDTO =>
  ({ ...base, id, name: `sp ${id}`, startDate, endDate, domainId, notes: "" });

const data: PlanData = {
  domains: [
    { id: 2, key: "b", name: "תחום ב", sortOrder: 2, isSingleTeam: false },
    { id: 1, key: "a", name: "תחום א", sortOrder: 1, isSingleTeam: false },
  ],
  teams: [
    { id: 11, key: "a1", name: "צוות א1", domainId: 1, sortOrder: 1 },
    { id: 12, key: "a2", name: "צוות א2", domainId: 1, sortOrder: 2 },
    { id: 21, key: "b1", name: "צוות ב1", domainId: 2, sortOrder: 1 },
  ],
  rows: [
    { id: 101, kind: "TEAM", teamId: 11, sortOrder: 1, version: 1 },
    { id: 102, kind: "TEAM", teamId: 11, sortOrder: 2, version: 1 },
    { id: 103, kind: "TEAM", teamId: 12, sortOrder: 1, version: 1 },
    { id: 201, kind: "TEAM", teamId: 21, sortOrder: 1, version: 1 },
    { id: 900, kind: "INFLUENCE", teamId: null, sortOrder: 0, version: 1 },
    { id: 901, kind: "CROSS_EVENT", teamId: null, sortOrder: 0, version: 1 },
  ],
  items: [
    item(1, 101, 11, "2026-11-01", "2026-11-15"),
    item(2, 102, 11, "2027-03-07", "2027-03-14"), // מחוץ לטווח המצומצם
    item(3, 201, 21, "2026-11-08", "2026-11-08", { status: "DONE" }),
    item(4, 900, null, "2026-11-01", "2026-11-22"),
    item(5, 900, null, "2026-11-08", "2026-11-08"), // חופף ל-4 → נתיב נוסף
  ],
  milestones: [ms(1, "2026-11-04", 11, null), ms(2, "2026-11-10", null, 1), ms(3, "2026-11-12", null, null), ms(4, "2026-11-12", 21, null)],
  sprints: [sprint(1, 1, "2026-11-01", "2026-11-14"), sprint(2, 1, "2026-11-10", "2026-11-20"), sprint(3, 2, "2026-11-01", "2026-11-14")],
  users: [],
};
const view = defaultViewConfig();
const all = [CROSS_FILTER.INFLUENCE, CROSS_FILTER.CROSS_EVENT, 1, 2];
const opts = { from: "2026-11-01", to: "2026-11-29", domainIds: all, milestones: false, sprints: false };

describe("gantt export model", () => {
  it("defaults: the whole gantt, and the domains shown in the current filter", () => {
    expect(fullRange(data)).toEqual(["2025-12-28", "2027-12-26"]); // השנה הנוכחית והבאה במלואן (לפחות)
    expect(defaultDomainIds(data, view).sort()).toEqual([...all].sort());
    expect(defaultDomainIds(data, { ...view, domainIds: [2, CROSS_FILTER.INFLUENCE] })).toEqual([CROSS_FILTER.INFLUENCE, 2]);
  });

  it("orders domains by sortOrder, keeps only items in the week window, drops empty rows", () => {
    const m = buildExportModel(data, view, opts);
    expect(m.timeline.weeks.length).toBe(5);
    expect(m.domains.map((d) => d.domain.id)).toEqual([1, 2]);
    const a1 = m.domains[0].teams[0];
    expect(a1.lanes.map((l) => l.map((i) => i.id))).toEqual([[1]]); // שורה 102 ריקה בטווח → לא מיוצאת
    expect(m.domains[0].teams[1].lanes).toEqual([[]]); // צוות ללא תכולות נשאר עם נתיב ריק
    expect(m.rows.map((r) => r.item.id).sort()).toEqual([1, 3, 4, 5]);
  });

  it("lays overlapping cross items out in separate lanes", () => {
    const m = buildExportModel(data, view, opts);
    expect(m.cross.map((c) => c.kind)).toEqual(["INFLUENCE", "CROSS_EVENT"]);
    expect(m.cross[0].lanes.map((l) => l.map((i) => i.id))).toEqual([[4], [5]]);
  });

  it("exports only the selected domains and cross rows", () => {
    const m = buildExportModel(data, view, { ...opts, domainIds: [2] });
    expect(m.cross).toEqual([]);
    expect(m.domains.map((d) => d.domain.id)).toEqual([2]);
    expect(m.rows.map((r) => r.item.id)).toEqual([3]);
  });

  it("applies the user's other filters (status, team)", () => {
    expect(buildExportModel(data, { ...view, statuses: ["DONE"] }, opts).rows.map((r) => r.item.id)).toEqual([3]);
    const m = buildExportModel(data, { ...view, teamIds: [12] }, opts);
    expect(m.domains[0].teams.map((t) => t.team.id)).toEqual([12]);
    // תחום שאין בו צוות מסונן (נוסף בחלון הייצוא) מיוצא במלואו
    expect(m.domains[1].teams.map((t) => t.team.id)).toEqual([21]);
  });

  it("milestones and sprints are included only when requested", () => {
    const none = buildExportModel(data, view, opts);
    expect(none.milestones).toEqual([]);
    expect(none.sprints).toEqual([]);
    const m = buildExportModel(data, view, { ...opts, milestones: true, sprints: true });
    expect(m.milestones.map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(m.domains[0].teams[0].milestones.map((x) => x.id)).toEqual([1]);
    expect(m.domains[0].milestones.map((x) => x.id)).toEqual([2]);
    expect(m.cross[1].milestones.map((x) => x.id)).toEqual([3]);
    // ספרינטים חופפים → שני נתיבים
    expect(m.domains[0].sprintLanes.map((l) => l.map((s) => s.id))).toEqual([[1], [2]]);
    // ללא תחום ב — אבן הדרך של צוות ב1 והספרינט שלו לא מיוצאים
    const onlyA = buildExportModel(data, view, { ...opts, domainIds: [1], milestones: true, sprints: true });
    expect(onlyA.milestones.map((x) => x.id)).toEqual([1, 2]);
    expect(onlyA.sprints.map((x) => x.id)).toEqual([1, 2]);
  });

  it("builds a safe file name", () => {
    expect(exportFileName("pdf", "2026-11-01")).toBe("תוכנית עבודה - 2026-11-01.pdf");
    expect(exportFileName("xlsx", "2026-11-01", 'Q4: "מאושר"')).toBe("תוכנית עבודה - Q4- -מאושר- - 2026-11-01.xlsx");
  });
});
