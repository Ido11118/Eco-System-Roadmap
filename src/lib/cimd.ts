// Client ID Metadata Document (CIMD): במקום להירשם מראש, הלקוח (למשל Claude) מזדהה בכתובת https
// של מסמך JSON ציבורי שמתאר אותו (שם וכתובות חזרה). השרת קורא את המסמך ובודק שה-client_id שבו זהה לכתובת.
// לוגיקה טהורה — הקריאה לרשת ופענוח ה-DNS מוזרקים, כדי שאפשר לבדוק אותה בלי רשת.
import { validRedirectUri } from "./oauth";

export const CIMD_MAX_BYTES = 64 * 1024;

/** client_id שהוא כתובת מסמך זיהוי: https, עם נתיב, בלי fragment / פרטי משתמש / נקודות בנתיב */
export function isCimdClientId(id: string): boolean {
  if (!id.startsWith("https://") || id.length > 2048) return false;
  // "." / ".." בנתיב — בודקים על המחרוזת המקורית (מפענח ה-URL מנרמל אותם בשקט)
  if (/\/\.{1,2}(?=\/|\?|#|$)/.test(id.slice(8))) return false;
  let u: URL;
  try { u = new URL(id); } catch { return false; }
  return !(u.hash || u.username || u.password || u.pathname === "/" || !u.pathname);
}

/** כתובת IP פרטית / מקומית — לא פונים אליה (הגנה מ-SSRF: שימוש בשרת כדי לסרוק את הרשת הפנימית) */
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9")
    || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
}

/** authMethod: "none" (לקוח ציבורי, PKCE בלבד) או "private_key_jwt" (חתימה במפתח שמפורסם ב-jwksUri — למשל ChatGPT) */
export type CimdClient = { name: string; redirectUris: string[]; authMethod: "none" | "private_key_jwt"; jwksUri: string | null };

/** בדיקת תוכן המסמך */
export function parseCimdDocument(url: string, doc: unknown): CimdClient {
  const d = (doc ?? {}) as Record<string, unknown>;
  if (d.client_id !== url) throw new Error("client_id in the metadata document does not match its URL");
  const uris = Array.isArray(d.redirect_uris) ? d.redirect_uris.filter((x): x is string => typeof x === "string") : [];
  if (!uris.length || uris.length > 20 || uris.some((u) => !validRedirectUri(u))) throw new Error("invalid redirect_uris in the metadata document");
  const method = d.token_endpoint_auth_method ?? "none";
  if (method !== "none" && method !== "private_key_jwt") throw new Error(`unsupported token_endpoint_auth_method: ${String(method)}`);
  let jwksUri: string | null = null;
  if (method === "private_key_jwt") {
    jwksUri = typeof d.jwks_uri === "string" ? d.jwks_uri : "";
    let ok = false;
    try { const j = new URL(jwksUri); ok = j.protocol === "https:" && !j.username && !j.password && jwksUri.length <= 2048; } catch { ok = false; }
    if (!ok) throw new Error("private_key_jwt requires an https jwks_uri in the metadata document");
  }
  const name = (typeof d.client_name === "string" && d.client_name.trim() ? d.client_name.trim() : new URL(url).host).slice(0, 80);
  return { name, redirectUris: uris, authMethod: method, jwksUri };
}

export type CimdDeps = {
  lookup: (host: string) => Promise<string[]>;
  fetchText: (url: string) => Promise<{ status: number; type: string; text: string }>;
};

export async function loadCimd(url: string, deps: CimdDeps): Promise<CimdClient> {
  if (!isCimdClientId(url)) throw new Error("client_id is not a valid metadata document URL");
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const ips = await deps.lookup(host);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error("metadata document host is not allowed");
  const r = await deps.fetchText(url);
  if (r.status !== 200) throw new Error(`metadata document returned HTTP ${r.status}`);
  if (r.text.length > CIMD_MAX_BYTES) throw new Error("metadata document is too large");
  let doc: unknown;
  try { doc = JSON.parse(r.text); } catch { throw new Error("metadata document is not valid JSON"); }
  return parseCimdDocument(url, doc);
}
