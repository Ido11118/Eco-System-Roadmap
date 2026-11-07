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
  it("week labels follow Monday ISO numbering while dates remain Sunday–Saturday", () => {
    expect(W.weekYearStart(2026)).toBe("2025-12-28");
    expect(W.weekNumber("2025-12-28")).toBe(1); // 28/12/2025–03/01/2026
    expect(W.weekYear("2025-12-28")).toBe(2026);
    expect(W.weekNumber("2026-10-18")).toBe(43); // 18/10–24/10/2026
    expect(W.weekNumber("2026-10-11")).toBe(42);
    expect(W.sundayOfWeekNumber(2026, 43)).toBe("2026-10-18");
    expect(W.weekNumber("2026-12-20")).toBe(52);
    expect([W.weekNumber("2026-12-27"), W.weekYear("2026-12-27")]).toEqual([53, 2026]); // 27/12/2026–02/01/2027
    expect([W.weekNumber("2023-01-01"), W.weekYear("2023-01-01")]).toEqual([1, 2023]); // שנה שמתחילה ביום ראשון
    expect(W.weekLabel("2026-12-27")).toBe("שבוע 53 (2026)");
  });
  it("starts 2027 on January 3 and round-trips week 53 of 2026", () => {
    expect(W.weekYearStart(2027)).toBe("2027-01-03");
    expect([W.weekNumber("2027-01-03"), W.weekYear("2027-01-03")]).toEqual([1, 2027]);
    expect(W.weekNumber("2027-01-10")).toBe(2);
    expect(W.sundayOfWeekNumber(2026, 53)).toBe("2026-12-27");
    expect(W.sundayOfWeekNumber(2027, 1)).toBe("2027-01-03");
    const t = W.buildTimeline("2026-12-20", "2027-01-10");
    expect(t.weeks.map((w) => [w.start, w.num])).toEqual([["2026-12-20", 52], ["2026-12-27", 53], ["2027-01-03", 1], ["2027-01-10", 2]]);
  });
  it("round-trips every Sunday across leap years and every New Year weekday", () => {
    for (let day = "2000-01-02"; day <= "2040-12-30"; day = W.addWeeks(day, 1)) {
      const year = W.weekYear(day), num = W.weekNumber(day);
      expect(num).toBeGreaterThanOrEqual(1); expect(num).toBeLessThanOrEqual(53);
      expect(W.sundayOfWeekNumber(year, num)).toBe(day);
    }
  });
  it("timeline handles month/year boundaries and real month lengths", () => {
    const t = W.buildTimeline("2025-12-01", "2026-03-31");
    expect(t.weeks[0].start).toBe("2025-11-30"); // שייך לנובמבר
    expect(t.months[0].label).toBe("נובמבר");
    const months = t.months.map((m) => `${m.label}:${m.count}`);
    expect(months).toEqual(["נובמבר:1", "דצמבר:4", "ינואר:4", "פברואר:4", "מרץ:5"]); // כותרות לפי יום ראשון — ללא שינוי
    expect(t.years.map((y) => y.count)).toEqual([5, 13]);
    expect(t.weeks.find((w) => w.start === "2025-12-28")?.num).toBe(1); // שבוע 1 של 2026 מתחיל בדצמבר
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
