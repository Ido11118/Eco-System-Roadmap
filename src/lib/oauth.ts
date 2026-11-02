// OAuth לחיבור עוזרי AI — לוגיקה טהורה (ללא בסיס נתונים), משותפת לשרת ולבדיקות.
import crypto from "crypto";

export const SCOPE_READ = "plan:read";
export const SCOPE_WRITE = "plan:write";
export const SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;
export type Access = "read" | "write";

export const ACCESS_TTL_SEC = 3600; // מפתח גישה: שעה
export const REFRESH_TTL_DAYS = 90; // מפתח חידוש: 90 יום (מתחדש בכל שימוש)
export const CODE_TTL_SEC = 300; // קוד חד-פעמי: 5 דקות

/** הרשאה מתוך מחרוזת scope. ריק = כל מה שקיים (הבחירה בפועל נעשית במסך האישור). */
export function parseScope(scope: string | null | undefined): Set<string> {
  const parts = (scope ?? "").split(/\s+/).filter(Boolean);
  return new Set(parts.length ? parts : SCOPES);
}
export function scopeFor(access: Access): string {
  return access === "write" ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ;
}
export function accessOf(scope: string): Access {
  return parseScope(scope).has(SCOPE_WRITE) ? "write" : "read";
}
/** בקשת scope תקינה: רק ערכים מוכרים */
export function validScope(scope: string | null | undefined): boolean {
  return [...parseScope(scope)].every((s) => (SCOPES as readonly string[]).includes(s));
}

/**
 * כתובת חזרה מותרת ללקוח: https, או http רק לכתובת מקומית (אפליקציות דסקטופ / Claude Code — RFC 8252).
 * ללא fragment, ללא פרטי משתמש.
 */
export function validRedirectUri(u: string): boolean {
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** PKCE (S256): ה-verifier שנשלח עכשיו תואם לטביעת האצבע שנשלחה בתחילת התהליך */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const calc = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(calc), b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** המשאב (resource, RFC 8707) — אם נשלח, חייב להיות שרת ה-MCP של המערכת */
export function validResource(resource: string | null | undefined, mcpUrl: string): boolean {
  if (!resource) return true;
  return resource.replace(/\/+$/, "") === mcpUrl.replace(/\/+$/, "");
}

export function newToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
}
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

/** תיאור קצר וידידותי של הלקוח למסך האישור: שם + הדומיין שאליו נחזור (קשה לזייף) */
/** כתובות חזרה של עוזרי AI מוכרים — כל כתובת אחרת מסומנת במסך האישור באזהרה בולטת (שם הלקוח לבדו ניתן לזיוף) */
const KNOWN_HOSTS = ["claude.ai", "claude.com", "anthropic.com", "chatgpt.com", "openai.com", "localhost", "127.0.0.1"];
export function isKnownAiHost(host: string): boolean {
  const h = host.replace(/:\d+$/, "").toLowerCase();
  return KNOWN_HOSTS.some((k) => h === k || h.endsWith(`.${k}`));
}

export function redirectHost(u: string): string {
  try { return new URL(u).host; } catch { return u; }
}
