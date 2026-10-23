import { describe, it, expect } from "vitest";
import { legacyWeekNumber, remapLegacyDate, remapLegacyWeek } from "@/lib/weekFix";
import { addDays, addWeeks, dayOfWeek, weekNumber, weekStartOf, weekYear } from "@/lib/weeks";

describe("week numbering fix (10/2026)", () => {
  it("legacy numbering is what users saw: 18/10/2026 (this week) was shown as 'week 42', 08/11/2026 as 'week 45'", () => {
    expect(legacyWeekNumber("2026-10-18")).toEqual({ year: 2026, num: 42 });
    expect(legacyWeekNumber("2026-11-08")).toEqual({ year: 2026, num: 45 });
  });
  it("an item keeps its week number: moved to the same number under the correct rule", () => {
    expect(remapLegacyWeek("2026-11-08")).toBe("2026-11-01"); // "שבוע 45" → 01/11–07/11 (שבוע 45 האמיתי)
    expect(remapLegacyWeek("2026-10-18")).toBe("2026-10-11"); // "שבוע 42" → 11/10–17/10
    expect(remapLegacyWeek("2026-01-04")).toBe("2025-12-28"); // "שבוע 1" של 2026
    expect(remapLegacyWeek("2026-12-27")).toBe("2026-12-20"); // "שבוע 52" של 2026
    expect(remapLegacyWeek("2027-01-03")).toBe("2026-12-27"); // "שבוע 1" של 2027
    expect(remapLegacyWeek("2023-01-08")).toBe("2023-01-08"); // שנה שמתחילה ביום ראשון — ללא שינוי
  });
  it("for every Sunday 2024–2030: same number and year after the fix, and order is preserved (no new overlaps)", () => {
    let prev = "";
    for (let s = "2024-01-07"; s <= "2030-12-29"; s = addWeeks(s, 1)) {
      const before = legacyWeekNumber(s), after = remapLegacyWeek(s);
      expect([weekNumber(after), weekYear(after)]).toEqual([before.num, before.year]);
      if (prev) expect(after > prev).toBe(true);
      prev = after;
    }
  });
  it("milestones/sprints: same week number AND same weekday (e.g. a sprint from 'week 42' to 'week 43' stays 42–43)", () => {
    // ספרינט שהוצג משבוע 42 (יום שני 19/10) עד שבוע 43 (יום חמישי 29/10) לפי המספור הישן
    expect(legacyWeekNumber(weekStartOf("2026-10-19")).num).toBe(42);
    expect(legacyWeekNumber(weekStartOf("2026-10-29")).num).toBe(43);
    const a = remapLegacyDate("2026-10-19"), b = remapLegacyDate("2026-10-29");
    expect([a, b]).toEqual(["2026-10-12", "2026-10-22"]);
    expect([weekNumber(weekStartOf(a)), weekNumber(weekStartOf(b))]).toEqual([42, 43]);
    expect([dayOfWeek(a), dayOfWeek(b)]).toEqual([1, 4]);
  });
  it("every day 2024–2030 keeps its week number, year and weekday", () => {
    for (let d = "2024-01-07"; d <= "2030-12-31"; d = addDays(d, 1)) {
      const before = legacyWeekNumber(weekStartOf(d)), after = remapLegacyDate(d);
      expect([weekNumber(weekStartOf(after)), weekYear(weekStartOf(after)), dayOfWeek(after)]).toEqual([before.num, before.year, dayOfWeek(d)]);
    }
  });
});
