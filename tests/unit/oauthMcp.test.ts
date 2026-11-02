import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { accessOf, isKnownAiHost, redirectUriMatches, parseScope, scopeFor, validRedirectUri, validResource, validScope, verifyPkce } from "@/lib/oauth";
import { parseWeek, parseDate } from "@/lib/mcpFormat";

describe("oauth helpers", () => {
  it("PKCE S256: only the original verifier matches", () => {
    const verifier = crypto.randomBytes(40).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(crypto.randomBytes(40).toString("base64url"), challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false); // RFC 7636: 43–128 תווים
  });

  it("redirect URIs: https anywhere, http only on loopback, never fragments or credentials", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(validRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(validRedirectUri("http://127.0.0.1:5000/cb")).toBe(true);
    expect(validRedirectUri("http://evil.example/cb")).toBe(false);
    expect(validRedirectUri("https://a.example/cb#x")).toBe(false);
    expect(validRedirectUri("https://user:pw@a.example/cb")).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
    expect(validRedirectUri("not a url")).toBe(false);
  });

  it("scopes: read / read+write, unknown scopes rejected", () => {
    expect(scopeFor("read")).toBe("plan:read");
    expect(scopeFor("write")).toBe("plan:read plan:write");
    expect(accessOf("plan:read plan:write")).toBe("write");
    expect(accessOf("plan:read")).toBe("read");
    expect([...parseScope("")]).toEqual(["plan:read", "plan:write"]);
    expect(validScope("plan:read")).toBe(true);
    expect(validScope("plan:read admin")).toBe(false);
  });

  it("resource indicator must be this MCP server", () => {
    expect(validResource(undefined, "https://x.example/api/mcp")).toBe(true);
    expect(validResource("https://x.example/api/mcp/", "https://x.example/api/mcp")).toBe(true);
    expect(validResource("https://other.example/api/mcp", "https://x.example/api/mcp")).toBe(false);
  });
});

describe("mcp week parsing", () => {
  it("accepts any day of the week, or the organization's week numbers", () => {
    expect(parseWeek("2026-11-04")).toBe("2026-11-01"); // רביעי → ראשון של אותו שבוע
    expect(parseWeek("45/2026")).toBe("2026-11-01");
    expect(parseWeek("W45/2026")).toBe("2026-11-01");
    expect(parseWeek("2026-W45")).toBe("2026-11-01");
    expect(parseWeek("שבוע 45 2026")).toBe("2026-11-01");
    expect(parseWeek("1/2026")).toBe("2025-12-28"); // שבוע 1 = השבוע שבו חל ה-1 בינואר
  });
  it("rejects what it cannot understand, with a helpful message", () => {
    expect(() => parseWeek("next tuesday")).toThrow(/N\/YYYY/);
    expect(() => parseWeek("54/2026")).toThrow();
    expect(() => parseDate("2026-02-30")).toThrow();
    expect(parseDate("2026-02-28")).toBe("2026-02-28");
  });
});

import { isCimdClientId, isPrivateIp, loadCimd, parseCimdDocument } from "@/lib/cimd";
import { verifyIdTokenClaims, decodeJwtPayload, googleOwnsEmail } from "@/lib/googleClaims";

describe("client id metadata documents (CIMD)", () => {
  const url = "https://claude.ai/oauth/claude-code-client-metadata";
  const doc = { client_id: url, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" };
  const deps = (ips: string[], body: unknown, status = 200) => ({
    lookup: async () => ips,
    fetchText: async () => ({ status, type: "application/json", text: JSON.stringify(body) }),
  });

  it("recognizes https document URLs only", () => {
    expect(isCimdClientId(url)).toBe(true);
    expect(isCimdClientId("wpc_abc")).toBe(false);
    expect(isCimdClientId("http://claude.ai/x")).toBe(false);
    expect(isCimdClientId("https://claude.ai/")).toBe(false);
    expect(isCimdClientId("https://claude.ai/a/../b")).toBe(false);
  });

  it("loads a valid document", async () => {
    expect(await loadCimd(url, deps(["160.79.104.10"], doc))).toEqual({ name: "Claude", redirectUris: doc.redirect_uris });
  });

  it("refuses private network hosts (SSRF)", async () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1"]) {
      expect(isPrivateIp(ip)).toBe(true);
      await expect(loadCimd(url, deps([ip], doc))).rejects.toThrow(/not allowed/);
    }
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });

  it("requires the document to name itself and list valid redirect URIs", async () => {
    expect(() => parseCimdDocument(url, { ...doc, client_id: "https://evil.example/x" })).toThrow(/does not match/);
    expect(() => parseCimdDocument(url, { ...doc, redirect_uris: ["http://evil.example/cb"] })).toThrow(/redirect_uris/);
    expect(() => parseCimdDocument(url, { ...doc, token_endpoint_auth_method: "private_key_jwt" })).toThrow(/unsupported/);
    await expect(loadCimd(url, deps(["8.8.8.8"], doc, 404))).rejects.toThrow(/404/);
  });
});

describe("google id token claims", () => {
  const cfg = { clientId: "cid.apps.googleusercontent.com", allowedDomains: [] as string[] };
  const base = { iss: "https://accounts.google.com", aud: cfg.clientId, exp: Math.floor(Date.now() / 1000) + 600, nonce: "n1", sub: "1234567890", email: "Dana@Org.com", email_verified: true, name: "דנה" };

  it("accepts a valid token and normalizes the email", () => {
    expect(verifyIdTokenClaims(base, cfg, "n1")).toEqual({ sub: "1234567890", email: "dana@org.com", name: "דנה", hd: null });
  });
  it("requires the stable Google account id (sub)", () => {
    expect(() => verifyIdTokenClaims({ ...base, sub: undefined }, cfg, "n1")).toThrow();
  });
  it("auto-links to an existing account only when Google owns the address (Workspace hd or Gmail)", () => {
    expect(googleOwnsEmail({ email: "dana@org.com", hd: "org.com" })).toBe(true);
    expect(googleOwnsEmail({ email: "dana@gmail.com", hd: null })).toBe(true);
    expect(googleOwnsEmail({ email: "dana@org.com", hd: null })).toBe(false); // מייל ארגוני כחשבון Google פרטי
  });
  it("rejects wrong audience, issuer, nonce, expiry or unverified email", () => {
    expect(() => verifyIdTokenClaims({ ...base, aud: "other" }, cfg, "n1")).toThrow();
    expect(() => verifyIdTokenClaims({ ...base, iss: "https://evil.example" }, cfg, "n1")).toThrow();
    expect(() => verifyIdTokenClaims(base, cfg, "other-nonce")).toThrow();
    expect(() => verifyIdTokenClaims({ ...base, exp: 1000 }, cfg, "n1")).toThrow();
    expect(() => verifyIdTokenClaims({ ...base, email_verified: false }, cfg, "n1")).toThrow(/מאומתת/);
  });
  it("enforces the organization's Google Workspace domain when configured", () => {
    const org = { ...cfg, allowedDomains: ["org.com"] };
    expect(verifyIdTokenClaims({ ...base, hd: "org.com" }, org, "n1").hd).toBe("org.com");
    expect(() => verifyIdTokenClaims(base, org, "n1")).toThrow(/@org.com/); // ג'ימייל פרטי — בלי hd
    expect(() => verifyIdTokenClaims({ ...base, hd: "other.com" }, org, "n1")).toThrow();
  });
  it("decodes the JWT payload", () => {
    const jwt = ["x", Buffer.from(JSON.stringify({ a: "ש" })).toString("base64url"), "sig"].join(".");
    expect(decodeJwtPayload(jwt)).toEqual({ a: "ש" });
  });
});

describe("known AI redirect hosts (consent warning)", () => {
  it("recognizes Claude / ChatGPT / localhost and flags anything else", () => {
    for (const h of ["claude.ai", "www.claude.ai", "claude.com", "chatgpt.com", "localhost:6274", "127.0.0.1:3000"]) expect(isKnownAiHost(h)).toBe(true);
    for (const h of ["evil.com", "claude.ai.evil.com", "notclaude.ai"]) expect(isKnownAiHost(h)).toBe(false);
  });
});

describe("redirect URI matching (RFC 8252 loopback)", () => {
  const reg = ["http://localhost/callback", "http://127.0.0.1/callback", "https://claude.ai/api/mcp/auth_callback"];
  it("accepts exact matches and any port on a registered loopback address (Claude Code)", () => {
    expect(redirectUriMatches(reg, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectUriMatches(reg, "http://localhost:54123/callback")).toBe(true);
    expect(redirectUriMatches(reg, "http://127.0.0.1:61000/callback")).toBe(true);
  });
  it("rejects other paths, hosts, schemes and non-loopback ports", () => {
    expect(redirectUriMatches(reg, "http://localhost:54123/other")).toBe(false);
    expect(redirectUriMatches(reg, "http://evil.com:54123/callback")).toBe(false);
    expect(redirectUriMatches(reg, "https://localhost:54123/callback")).toBe(false);
    expect(redirectUriMatches(reg, "https://claude.ai:8443/api/mcp/auth_callback")).toBe(false);
    expect(redirectUriMatches(["http://localhost/callback"], "http://127.0.0.1:5000/callback")).toBe(false);
  });
});
