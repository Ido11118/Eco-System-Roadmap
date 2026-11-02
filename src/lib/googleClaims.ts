// בדיקת תוכן ה-ID Token שמתקבל מ-Google (לוגיקה טהורה — נבדקת בבדיקות יחידה)

/**
 * האם Google הוא הגורם המוסמך לכתובת: חשבון Google Workspace של הארגון (יש hd), או Gmail.
 * רק אז מקשרים אוטומטית לחשבון קיים לפי המייל. כתובת אחרת (למשל מייל ארגוני שנרשם כחשבון Google פרטי)
 * יכולה להישאר אצל מי שהחזיק בה בעבר — לכן לא מקשרים אותה לבד לחשבון קיים.
 */
export function googleOwnsEmail(id: { email: string; hd: string | null }): boolean {
  return !!id.hd || /@(gmail|googlemail)\.com$/.test(id.email);
}
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleIdentity = { sub: string; email: string; name: string; hd: string | null };

export class ClaimsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new ClaimsError(400, "תשובה לא תקינה מ-Google");
  try { return JSON.parse(Buffer.from(part, "base64url").toString("utf8")); } catch { throw new ClaimsError(400, "תשובה לא תקינה מ-Google"); }
}

export function verifyIdTokenClaims(c: Record<string, unknown>, cfg: { clientId: string; allowedDomains: string[] }, nonce: string, now = Date.now()): GoogleIdentity {
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!ISSUERS.includes(String(c.iss))) throw new ClaimsError(400, "מנפיק לא צפוי בתשובה מ-Google");
  if (!aud.includes(cfg.clientId)) throw new ClaimsError(400, "התשובה מ-Google לא נועדה למערכת זו");
  if (typeof c.exp !== "number" || c.exp * 1000 < now - 60000) throw new ClaimsError(400, "פג תוקף ההתחברות. נסה שוב.");
  if (c.nonce !== nonce) throw new ClaimsError(400, "ההתחברות לא תקינה. נסה שוב.");
  const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!email || (c.email_verified !== true && c.email_verified !== "true")) throw new ClaimsError(403, "כתובת הדוא\"ל בחשבון Google אינה מאומתת");
  const hd = typeof c.hd === "string" ? c.hd.toLowerCase() : null;
  if (cfg.allowedDomains.length && !(hd && cfg.allowedDomains.includes(hd))) {
    throw new ClaimsError(403, `ניתן להתחבר רק עם חשבון Google ארגוני (${cfg.allowedDomains.map((d) => `@${d}`).join(", ")})`);
  }
  const sub = typeof c.sub === "string" ? c.sub.trim() : "";
  if (!sub || sub.length > 255) throw new ClaimsError(400, "תשובה לא תקינה מ-Google");
  const name = typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 120) : email.split("@")[0];
  return { sub, email, name, hd };
}

