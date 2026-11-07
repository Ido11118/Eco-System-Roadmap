import { describe, expect, it } from "vitest";
import { fittingBarFont, MIN_BAR_FONT } from "@/lib/barText";
import { preferencesSchema, viewConfigSchema } from "@/lib/validation";
import { defaultViewConfig } from "@/components/plan/filters";
import { STATUS_META } from "@/lib/constants";
import catalog from "../../config/catalog.json";

describe("fit item text", () => {
  it("keeps short text at the user's maximum and shrinks other labels independently", () => {
    expect(fittingBarFont(18, () => true)).toBe(18);
    expect(fittingBarFont(18, (n) => n <= 13)).toBe(13);
    expect(fittingBarFont(12, (n) => n <= 13)).toBe(12);
  });
  it("never falls below the readable minimum, even when no size fits", () => {
    expect(fittingBarFont(20, () => false)).toBe(MIN_BAR_FONT);
    expect(fittingBarFont(9, () => true)).toBe(10);
  });
  it("persists both checked and unchecked preferences and saved display settings", () => {
    for (const fitBarText of [true, false]) {
      expect(preferencesSchema.parse({ fitBarText }).fitBarText).toBe(fitBarText);
      expect(viewConfigSchema.parse({ ...defaultViewConfig(), display: { fitBarText, barFontSize: 16 } }).display?.fitBarText).toBe(fitBarText);
    }
    expect(preferencesSchema.safeParse({ fitBarText: "true" }).success).toBe(false);
  });
});

it("renames the red status without changing its key, color or stored category", () => {
  expect(STATUS_META.BLOCKED.label).toBe("לא בוצע");
  expect(catalog.statuses.find((s) => s.key === "BLOCKED")).toMatchObject({ label: "לא בוצע", bg: "#dc2626", category: "planned" });
});
