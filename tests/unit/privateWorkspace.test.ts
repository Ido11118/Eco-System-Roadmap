import { describe, expect, it } from "vitest";
import { makeCatalog, DEFAULT_CATALOG } from "../../src/lib/catalog";
import { applyPrivateCommand, emptyPrivateState, privateCommandSchema, PRIVATE_DOMAIN, PRIVATE_TEAM, withPrivateWorkspace, type PrivateState } from "../../src/lib/privateWorkspace";
import { defaultViewConfig } from "../../src/components/plan/filters";
import type { PlanData } from "../../src/lib/types";

const cat = makeCatalog(DEFAULT_CATALOG);
const create = (s: PrivateState, name: string, startWeek: string, rowId = -1) => applyPrivateCommand(s, { action: "create", item: { name, rowId, startWeek, endWeek: startWeek } }, cat, 7);

describe("owned private workspace", () => {
  it("always starts with an editable private row and only generates negative IDs", () => {
    const initial = emptyPrivateState(); const r = create(initial, "private", "2026-11-01");
    expect(r.result.items![0]).toMatchObject({ id: -2, rowId: -1, teamId: PRIVATE_TEAM, version: 1, createdById: 7 });
    expect(initial.items).toEqual([]); expect(initial.nextId).toBe(-2);
  });
  it("applies group movement against final positions, including adjacent old positions", () => {
    let s = create(emptyPrivateState(), "a", "2026-11-01").state;
    s = create(s, "b", "2026-11-08").state;
    const r = applyPrivateCommand(s, { action: "update", entries: s.items.map((i, n) => ({ id: i.id, version: i.version, patch: { startWeek: n ? "2026-11-15" : "2026-11-08", endWeek: n ? "2026-11-15" : "2026-11-08" } })) }, cat, 7);
    expect(r.state.items.map((i) => i.startWeek)).toEqual(["2026-11-08", "2026-11-15"]);
    expect(s.items.map((i) => i.startWeek)).toEqual(["2026-11-01", "2026-11-08"]);
  });
  it("rejects overlap and stale versions without partially changing any item", () => {
    let s = create(emptyPrivateState(), "a", "2026-11-01").state;
    s = create(s, "b", "2026-11-08").state;
    const before = structuredClone(s);
    expect(() => applyPrivateCommand(s, { action: "update", entries: s.items.map((i) => ({ id: i.id, version: i.version, patch: { startWeek: "2026-11-15", endWeek: "2026-11-15" } })) }, cat, 7)).toThrow(/חופפות/);
    expect(() => applyPrivateCommand(s, { action: "delete", entries: s.items.map((i, n) => ({ id: i.id, version: n ? 999 : i.version })) }, cat, 7)).toThrow(/השתנו/);
    expect(s).toEqual(before);
  });
  it("rejects unavailable statuses, invalid ranges and row references", () => {
    const s = create(emptyPrivateState(), "a", "2026-11-01").state;
    for (const patch of [{ status: "does-not-exist" }, { endWeek: "2026-10-25" }, { rowId: -999 }]) {
      expect(() => applyPrivateCommand(s, { action: "update", entries: [{ id: s.items[0].id, version: 1, patch }] }, cat, 7)).toThrow();
    }
  });
  it("restores private items to a free private row without losing another item", () => {
    let s = create(emptyPrivateState(), "a", "2026-11-01").state;
    const deleted = applyPrivateCommand(s, { action: "delete", entries: [{ id: s.items[0].id, version: 1 }] }, cat, 7);
    s = create(deleted.state, "blocker", "2026-11-01").state;
    const r = applyPrivateCommand(s, { action: "restore", entries: [{ id: deleted.result.items![0].id, version: 2 }] }, cat, 7);
    expect(r.state.items).toHaveLength(2); expect(r.state.rows).toHaveLength(2);
    expect(r.state.items[0].rowId).not.toBe(r.state.items[1].rowId);
    expect(r.state.deletedItems).toEqual([]);
  });
  it("restores only the contents deleted with a row and preserves the final row", () => {
    let s = create(emptyPrivateState(), "a", "2026-11-01").state;
    s = applyPrivateCommand(s, { action: "createRow" }, cat, 7).state;
    const deleted = applyPrivateCommand(s, { action: "deleteRow", id: -1, version: 1 }, cat, 7);
    expect(deleted.state.rows).toHaveLength(1); expect(deleted.state.items).toEqual([]);
    const restored = applyPrivateCommand(deleted.state, { action: "restoreRow", id: -1, version: 2 }, cat, 7);
    expect(restored.state.items.map((i) => i.name)).toEqual(["a"]);
    expect(() => applyPrivateCommand(emptyPrivateState(), { action: "deleteRow", id: -1, version: 1 }, cat, 7)).toThrow(/לפחות שורה/);
  });
  it("rejects public identifiers, owner injection and duplicate mutations", () => {
    expect(privateCommandSchema.safeParse({ action: "delete", entries: [{ id: 1, version: 1 }] }).success).toBe(false);
    expect(privateCommandSchema.safeParse({ action: "createRow", userId: 99 }).success).toBe(false);
    const s = create(emptyPrivateState(), "a", "2026-11-01").state;
    expect(() => applyPrivateCommand(s, { action: "delete", entries: [{ id: -2, version: 1 }, { id: -2, version: 1 }] }, cat, 7)).toThrow(/יותר מפעם/);
  });
  it("adds a private domain only to the supplied personal view, even when empty", () => {
    const plan: PlanData = { items: [], rows: [], teams: [], domains: [], milestones: [], sprints: [], users: [] };
    const result = withPrivateWorkspace(plan, { ...emptyPrivateState(), version: 1 }, defaultViewConfig());
    expect(result.domains[0]).toMatchObject({ id: PRIVATE_DOMAIN, name: "גאנט עמר" });
    expect(result.rows).toHaveLength(1); expect(plan.rows).toEqual([]); expect(plan.domains).toEqual([]);
  });
});
