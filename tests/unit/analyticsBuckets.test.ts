import { describe, it, expect } from "vitest";
import { bucketOf, bucketsBetween, granularityFor } from "@/lib/analyticsBuckets";

describe("analytics buckets", () => {
  it("picks day / week / month by span", () => {
    expect(granularityFor("2026-10-01", "2026-10-30")).toBe("day");
    expect(granularityFor("2026-01-01", "2026-10-30")).toBe("week");
    expect(granularityFor("2024-01-01", "2026-10-30")).toBe("month");
  });
  it("includes empty buckets so the chart never skips a period", () => {
    expect(bucketsBetween("2026-10-30", "2026-11-02", "day")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(bucketsBetween("2026-10-14", "2026-10-27", "week")).toEqual(["2026-10-11", "2026-10-18", "2026-10-25"]); // שבועות מיום ראשון
    expect(bucketsBetween("2026-09-15", "2026-11-02", "month")).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
    expect(bucketOf("2026-10-21", "week")).toBe("2026-10-18");
  });
});
