import { describe, it, expect } from "vitest";
import { normalizeAppUrl } from "@/lib/appUrl";

describe("APP_URL normalization", () => {
  it("adds https:// when the scheme is missing (common Railway mistake)", () => {
    expect(normalizeAppUrl("eco-system-roadmap-production.up.railway.app")).toBe("https://eco-system-roadmap-production.up.railway.app");
    expect(normalizeAppUrl(" my-app.example.com/ ")).toBe("https://my-app.example.com");
  });
  it("keeps an explicit scheme and strips trailing slashes", () => {
    expect(normalizeAppUrl("https://a.example.com//")).toBe("https://a.example.com");
    expect(normalizeAppUrl("http://localhost:3001")).toBe("http://localhost:3001");
  });
  it("uses http for local addresses and a default when unset", () => {
    expect(normalizeAppUrl("localhost:3001")).toBe("http://localhost:3001");
    expect(normalizeAppUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(normalizeAppUrl(undefined)).toBe("http://localhost:3000");
    expect(normalizeAppUrl("")).toBe("http://localhost:3000");
  });
});
