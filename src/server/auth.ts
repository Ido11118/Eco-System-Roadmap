import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetTokens, sessions, users, userDomainPermissions } from "@/db/schema";
import type { Me, UserPreferences } from "@/lib/types";
import { ApiError } from "./errors";

export const SESSION_COOKIE = "wp_session";
const SESSION_DAYS = 14;

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("base64url");

function secureCookies() {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === "true";
  return (process.env.APP_URL ?? "").startsWith("https://");
}

export async function createSession(userId: number) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  // ניקוי שוטף של סשנים וקישורי איפוס שפג תוקפם — מונע גדילה בלתי מוגבלת של הטבלאות
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, now));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", expires: expiresAt,
  });
}

/** מזהה הסשן הנוכחי (לשמירתו בזמן ניתוק שאר החיבורים) */
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sha256(token) : null;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(userId: number) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** המשתמש המחובר (או null). נבדק מול בסיס הנתונים בכל בקשה — סטטוס והרשאות תמיד עדכניים. */
export async function getMe(): Promise<Me | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  if (!rows.length) return null;
  const u = rows[0].u;
  const perms = await db.select({ d: userDomainPermissions.domainId }).from(userDomainPermissions)
    .where(eq(userDomainPermissions.userId, u.id));
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    canEditCross: u.role === "SUPER" || u.canEditCross,
    domainIds: perms.map((p) => p.d),
    preferences: (u.preferences ?? {}) as UserPreferences,
  };
}

/** דורש משתמש מחובר ומאושר. משתמש ממתין/נדחה/מושעה מקבל 403 — גם בקריאות API ישירות. */
export async function requireApproved(): Promise<Me> {
  const me = await getMe();
  if (!me) throw new ApiError(401, "נדרשת התחברות");
  if (me.status !== "APPROVED") throw new ApiError(403, "החשבון אינו מאושר לצפייה במערכת");
  return me;
}

export async function requireSuper(): Promise<Me> {
  const me = await requireApproved();
  if (me.role !== "SUPER") throw new ApiError(403, "פעולה זו מותרת למנהל המערכת בלבד");
  return me;
}
