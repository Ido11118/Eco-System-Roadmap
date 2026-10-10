import { describe, it, expect } from "vitest";
import * as W from "@/lib/weeks";

describe("weeks", () => {
  it("week start is Sunday and current week of 2026-10-09 is 04/10–10/10", () => {
    expect(W.weekStartOf("2026-10-09")).toBe("2026-10-04");
    expect(W.weekRangeLabel("2026-10-04")).toBe("04/10/2026–10/10/2026");
    expect(W.currentWeekIL(new Date("2026-10-09T12:00:00Z"))).toBe("2026-10-04");
  });
  it("uses Israel time zone near midnight", () => {
    // שבת 23:30 UTC = ראשון 02:30 בישראל (שעון קיץ) — כבר שבוע חדש
    expect(W.currentWeekIL(new Date("2026-10-10T23:30:00Z"))).toBe("2026-10-11");
  });
  it("week numbering by Sunday's year", () => {
    expect(W.firstSundayOfYear(2026)).toBe("2026-01-04");
    expect(W.weekNumber("2026-01-04")).toBe(1);
    expect(W.weekNumber("2025-12-28")).toBe(52);
    expect(W.weekYear("2025-12-28")).toBe(2025);
    expect(W.sundayOfWeekNumber(2026, 40)).toBe("2026-10-04");
  });
  it("timeline handles month/year boundaries and real month lengths", () => {
    const t = W.buildTimeline("2025-12-01", "2026-03-31");
    expect(t.weeks[0].start).toBe("2025-11-30"); // שייך לנובמבר
    expect(t.months[0].label).toBe("נובמבר");
    const months = t.months.map((m) => `${m.label}:${m.count}`);
    expect(months).toEqual(["נובמבר:1", "דצמבר:4", "ינואר:4", "פברואר:4", "מרץ:5"]);
    expect(t.years.map((y) => y.count)).toEqual([5, 13]);
    for (let i = 1; i < t.weeks.length; i++) expect(W.daysDiff(t.weeks[i - 1].start, t.weeks[i].start)).toBe(7);
  });
  it("DST transitions do not break arithmetic", () => {
    expect(W.addWeeks("2026-03-22", 1)).toBe("2026-03-29");
    expect(W.addWeeks("2026-10-18", 1)).toBe("2026-10-25");
  });
  it("validates iso dates", () => {
    expect(W.isISODate("2026-02-30")).toBe(false);
    expect(W.isISODate("2026-02-28")).toBe(true);
  });
  it("quarter ranges", () => {
    expect(W.quarterRange(2026, 4)).toEqual(["2026-10-01", "2026-12-31"]);
    expect(W.sundaysInRange("2026-10-01", "2026-12-31")).toEqual(["2026-10-04", "2026-12-27"]);
  });
});
