import { describe, it, expect } from "vitest";
import { adminNotifyHtml, esc } from "@/lib/notifyTemplate";

describe("admin notification email", () => {
  it("escapes user-provided values (no HTML injection via name/note)", () => {
    const html = adminNotifyHtml({
      title: "משתמש חדש", intro: "x", ctaUrl: "https://app.example/admin", ctaLabel: "מעבר",
      rows: [{ label: "שם", value: `<img src=x onerror="alert(1)">דני` }, { label: "הערה", value: "a & b" }],
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;דני");
    expect(html).toContain("a &amp; b");
    expect(html).toContain('href="https://app.example/admin"');
    expect(html).toContain('dir="rtl"');
  });
  it("omits empty rows (e.g. a request without a note)", () => {
    const html = adminNotifyHtml({ title: "t", intro: "i", ctaUrl: "u", ctaLabel: "c", rows: [{ label: "הערה", value: "  " }, { label: "שם", value: "רון" }] });
    expect(html).not.toContain("הערה");
    expect(html).toContain("רון");
  });
  it("esc covers quotes", () => expect(esc(`'"`)).toBe("&#39;&quot;"));
});
