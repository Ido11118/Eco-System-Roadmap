import { describe, expect, it } from "vitest";
import { batchOverlap, shiftedEntries } from "../../src/lib/itemBatch";
import { batchItemsSchema } from "../../src/lib/validation";
import type { ItemDTO, RowDTO } from "../../src/lib/types";

const item = (id: number, startWeek: string, endWeek = startWeek, rowId = 1) => ({ id, version: 3, rowId, startWeek, endWeek } as ItemDTO);
const rows = [{ id: 1, kind: "TEAM" }, { id: 2, kind: "INFLUENCE" }] as RowDTO[];

describe("group movement", () => {
  it("moves adjacent selected items into old positions without a false collision", () => {
    const items = [item(1, "2026-12-27"), item(2, "2027-01-03")];
    const entries = shiftedEntries(items, 1);
    expect(entries.map((e) => e.patch?.startWeek)).toEqual(["2027-01-03", "2027-01-10"]);
    expect(batchOverlap({ rows, items }, items.map((i, n) => ({ ...i, ...entries[n].patch })))).toBeUndefined();
  });
  it("detects a collision with an unselected item", () => {
    const items = [item(1, "2026-11-01"), item(2, "2026-11-08")];
    expect(batchOverlap({ rows, items }, [{ ...items[0], startWeek: "2026-11-08", endWeek: "2026-11-08" }])?.id).toBe(2);
  });
  it("detects collisions inside the final selected arrangement", () => {
    expect(batchOverlap({ rows, items: [] }, [item(1, "2026-11-01", "2026-11-08"), item(2, "2026-11-08")])?.id).toBe(1);
  });
  it("allows overlap in cross rows and moves backwards across a year", () => {
    expect(batchOverlap({ rows, items: [] }, [item(1, "2026-11-01", undefined, 2), item(2, "2026-11-01", undefined, 2)])).toBeUndefined();
    expect(shiftedEntries([item(1, "2027-01-03", "2027-01-10")], -1)[0].patch).toEqual({ startWeek: "2026-12-27", endWeek: "2027-01-03" });
  });
});

describe("batch validation", () => {
  it("rejects duplicate IDs and updates without changes", () => {
    expect(batchItemsSchema.safeParse({ action: "delete", entries: [{ id: 1, version: 1 }, { id: 1, version: 1 }] }).success).toBe(false);
    expect(batchItemsSchema.safeParse({ action: "update", entries: [{ id: 1, version: 1, patch: {} }] }).success).toBe(false);
  });
  it("rejects arbitrary fields and non-Sunday dates", () => {
    for (const patch of [{ rowId: 2 }, { startWeek: "2026-11-02" }]) {
      expect(batchItemsSchema.safeParse({ action: "update", entries: [{ id: 1, version: 1, patch }] }).success).toBe(false);
    }
  });
});
