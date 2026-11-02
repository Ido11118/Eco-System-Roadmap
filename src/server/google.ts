import "server-only";
// התחברות עם Google (OpenID Connect, Authorization Code + PKCE).
// Google רק מזהה את המשתמש (מייל מאומת). ההרשאות, הסטטוס ותהליך האישור — של המערכת, בדיוק כמו בהתחברות עם סיסמה.
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, users } from "@/db/schema";
import { audit } from "./plan";
import { ApiError } from "./errors";
import { ClaimsError, decodeJwtPayload, googleOwnsEmail, verifyIdTokenClaims, type GoogleIdentity } from "@/lib/googleClaims";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_COOKIE = "wp_google";

export type GoogleConfig = { clientId: string; clientSecret: string; allowedDomains: string[] };

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const allowedDomains = (process.env.GOOGLE_ALLOWED_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  return { clientId, clientSecret, allowedDomains };
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export const googleRedirectUri = () => `${appUrl()}/api/auth/google/callback`;

/**
 * כתובת חזרה פנימית בלבד (מונע Open Redirect): נתיב יחסי באתר שלנו.
 * תווי בקרה (Tab / שורה חדשה) ו-"\" נדחים — הדפדפן מסיר אותם, ו-"/\t/evil.com" היה הופך ל-"//evil.com".
 * בסוף מוודאים שהכתובת המפוענחת נשארת באותו מקור (origin).
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.length > 2000 || !next.startsWith("/") || /[\x00-\x1f\x7f\\]/.test(next)) return null;
  try {
    const base = new URL(appUrl());
    const u = new URL(next, base);
    if (u.origin !== base.origin) return null;
    return u.pathname + u.search;
  } catch { return null; }
}

const b64url = (b: Buffer) => b.toString("base64url");

/** מצב ההתחברות שנשמר בעוגייה קצרת-מועד עד החזרה מ-Google */
export type GoogleFlow = { state: string; verifier: string; nonce: string; next: string | null };

export function startGoogleFlow(cfg: GoogleConfig, next: string | null): { url: string; flow: GoogleFlow } {
  const flow: GoogleFlow = {
    state: b64url(crypto.randomBytes(24)), verifier: b64url(crypto.randomBytes(48)), nonce: b64url(crypto.randomBytes(24)), next,
  };
  const challenge = b64url(crypto.createHash("sha256").update(flow.verifier).digest());
  const p = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: googleRedirectUri(), response_type: "code", scope: "openid email profile",
    state: flow.state, nonce: flow.nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  // דומיין ארגוני יחיד: Google מציג מראש רק חשבונות מהדומיין (הבדיקה האמיתית נעשית בחזרה)
  if (cfg.allowedDomains.length === 1) p.set("hd", cfg.allowedDomains[0]);
  return { url: `${AUTH_URL}?${p}`, flow };
}


/** החלפת הקוד במפתח זיהוי (ID Token) ואימות התוכן שלו */
export async function finishGoogleFlow(cfg: GoogleConfig, flow: GoogleFlow, code: string): Promise<GoogleIdentity> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code", code_verifier: flow.verifier,
    }),
  });
  const j = await r.json().catch(() => ({})) as { id_token?: string; error?: string; error_description?: string };
  if (!r.ok || !j.id_token) throw new ApiError(400, `Google דחה את ההתחברות${j.error ? ` (${j.error})` : ""}`);
  // ה-ID Token התקבל ישירות מ-Google בערוץ TLS מאומת (ולא דרך הדפדפן) — לפי OpenID Connect Core 3.1.3.7
  // מותר להסתמך על אימות השרת במקום אימות החתימה. בודקים את כל השדות.
  try { return verifyIdTokenClaims(decodeJwtPayload(j.id_token), cfg, flow.nonce); }
  catch (e) { throw new ApiError(e instanceof ClaimsError ? e.status : 400, (e as Error).message); }
}

function assertActive(u: typeof users.$inferSelect) {
  if (u.status === "REJECTED") throw new ApiError(403, "בקשת ההרשמה נדחתה. לפרטים פנה למנהל המערכת.");
  if (u.status === "SUSPENDED") throw new ApiError(403, "הגישה לחשבון הושעתה. לפרטים פנה למנהל המערכת.");
  return u;
}

/**
 * המשתמש במערכת לפי חשבון Google:
 * 1. חשבון Google שכבר קושר (לפי sub — מזהה קבוע של Google) → אותו משתמש, גם אם המייל בחשבון השתנה.
 * 2. משתמש קיים עם אותו מייל (השוואה באותיות קטנות; ייחודי בבסיס הנתונים) → אותו חשבון, אותן הרשאות,
 *    וחשבון ה-Google נקשר אליו. רק כש-Google מוסמך לכתובת (Workspace / Gmail), ורק אם לא קושר אליו חשבון Google אחר.
 * 3. אחרת — משתמש חדש בסטטוס "ממתין לאישור" (כמו בהרשמה רגילה), ומנהל המערכת מאשר ומגדיר הרשאות.
 */
export async function userForGoogle(id: GoogleIdentity) {
  const [bySub] = await db.select().from(users).where(eq(users.googleSub, id.sub));
  if (bySub) return assertActive(bySub);
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${id.email}`);
  if (u) {
    assertActive(u);
    if (u.googleSub) throw new ApiError(403, "לחשבון הזה כבר מקושר חשבון Google אחר. פנה למנהל המערכת.");
    if (!googleOwnsEmail(id)) throw new ApiError(403, "לכתובת הזו כבר יש חשבון במערכת. התחבר עם הדוא\"ל והסיסמה.");
    const [linked] = await db.update(users).set({ googleSub: id.sub, updatedAt: new Date() })
      .where(and(eq(users.id, u.id), isNull(users.googleSub))).returning();
    if (!linked) throw new ApiError(409, "ההתחברות נכשלה. נסה שוב.");
    await audit(db, u.id, "user", u.id, "linkGoogle", { email: id.email }, "חשבון Google קושר למשתמש (התחברות ראשונה עם Google)");
    return linked;
  }
  // אין סיסמה — נשמר Hash של ערך אקראי (לא ניתן להתחבר איתו). אפשר להגדיר סיסמה בהמשך דרך "שכחתי סיסמה".
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  try {
    return await db.transaction(async (tx) => {
      const [n] = await tx.insert(users).values({ email: id.email, fullName: id.name, passwordHash, status: "PENDING", googleSub: id.sub }).returning();
      await tx.insert(approvalRequests).values({ userId: n.id, requestedDomainIds: [], requestedCross: false });
      await audit(tx, n.id, "user", n.id, "register", { via: "google" }, "משתמש נרשם דרך Google וממתין לאישור");
      return n;
    });
  } catch (e) {
    // שתי התחברויות ראשונות במקביל (מייל / sub ייחודיים) — השנייה מקבלת את המשתמש שנוצר בראשונה
    if ((e as { code?: string }).code !== "23505") throw e;
    const [again] = await db.select().from(users).where(eq(users.googleSub, id.sub));
    if (!again) throw e;
    return assertActive(again);
  }
}
