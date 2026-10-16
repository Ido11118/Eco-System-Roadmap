import { describe, it, expect } from "vitest";
import { DEFAULT_CATALOG, makeCatalog, contrastText, borderFor } from "@/lib/catalog";
import { buildCompareUnits, summarize } from "@/lib/compare";
import type { ItemDTO, PlanData } from "@/lib/types";

describe("catalog", () => {
  it("defaults match the original fixed statuses and priorities", () => {
    const c = makeCatalog(DEFAULT_CATALOG);
    expect(c.statuses.map((s) => s.key)).toEqual(["PLANNED", "IN_PROGRESS", "DONE", "DONE_UNPLANNED", "BLOCKED", "WAITING", "POSTPONED", "CANCELLED"]);
    expect(c.defaultStatus).toBe("PLANNED");
    expect(c.defaultPriority).toBe("NONE");
    expect(c.status("DONE").label).toBe("בוצע");
    expect(c.category("CANCELLED")).toBe("cancelled");
    expect(c.status("BLOCKED").noteRecommended).toBe(true);
  });

  it("archived entries are hidden from pickers but still resolvable (old snapshots keep name/color)", () => {
    const c = makeCatalog({ ...DEFAULT_CATALOG, statuses: DEFAULT_CATALOG.statuses.map((s) => (s.key === "WAITING" ? { ...s, archived: true } : s)) });
    expect(c.statuses.some((s) => s.key === "WAITING")).toBe(false);
    expect(c.status("WAITING").label).toBe("ממתין לצוות אחר");
    expect(c.status("NOPE").label).toBe("NOPE"); // לא קיים כלל — מוצג המפתח, בצבע ניטרלי
  });

  it("contrast text and border colors", () => {
    expect(contrastText("#ffffff")).toBe("#1e293b");
    expect(contrastText("#15803d")).toBe("#ffffff");
    expect(borderFor("#ffffff")).toBe("#b8c0cc");
    expect(borderFor("#ff0000")).toBe("#d10000");
  });

  it("plan-vs-actual uses the status *category*, so a custom 'done' status counts as completed", () => {
    const base: Omit<ItemDTO, "id" | "status"> = {
      name: "x", rowId: 1, teamId: 10, startWeek: "2026-01-04", endWeek: "2026-01-04", priority: "NONE", notes: "", version: 1,
      createdAt: "", createdById: 1, updatedAt: "", updatedById: 1,
    };
    const plan = (items: ItemDTO[]): PlanData => ({
      domains: [], teams: [], rows: [{ id: 1, kind: "TEAM", teamId: 10, sortOrder: 1, version: 1 }], items, milestones: [], sprints: [], users: [],
    });
    const c = makeCatalog({ ...DEFAULT_CATALOG, statuses: [...DEFAULT_CATALOG.statuses, { key: "SHIPPED", label: "נשלח", bg: "#000000", fg: "#fff", border: "#000", category: "done", noteRecommended: false, sortOrder: 99, isDefault: false }] });
    const units = buildCompareUnits(plan([{ ...base, id: 1, status: "PLANNED" }]), plan([{ ...base, id: 1, status: "SHIPPED" }]), c.category);
    expect(units[0].tags).toContain("completed");
    expect(summarize(units).completed).toBe(1);
  });
});
