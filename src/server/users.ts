import "server-only";
import bcrypt from "bcryptjs";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, passwordResetTokens, userDomainPermissions, users, domains, sessions } from "@/db/schema";
import type { Me } from "@/lib/types";
import { ApiError } from "./errors";
import { audit } from "./plan";
import { randomToken, sha256 } from "./auth";
import { sendMail } from "./mail";

// הגבלת קצב בסיסית בזיכרון (כלי פנימי, תהליך יחיד)
const attempts = new Map<string, { n: number; until: number }>();
let lastPrune = 0;
export function rateLimit(key: string, max = 8, windowMs = 10 * 60000) {
  const now = Date.now();
  if (now - lastPrune > 60000) { // ניקוי רשומות שפג תוקפן — מונע גדילת זיכרון
    lastPrune = now;
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  }
  const a = attempts.get(key);
  if (!a || a.until < now) { attempts.set(key, { n: 1, until: now + windowMs }); return; }
  a.n++;
  if (a.n > max) throw new ApiError(429, "יותר מדי ניסיונות. נסה שוב בעוד מספר דקות.");
}

/** בדיקה ללא ספירה (לשימוש לפני הפעולה) */
export function assertNotLimited(key: string, max: number) {
  const a = attempts.get(key);
  if (a && a.until >= Date.now() && a.n >= max) throw new ApiError(429, "יותר מדי ניסיונות. נסה שוב בעוד מספר דקות.");
}

/** כתובת הלקוח: רק כאשר TRUST_PROXY=true סומכים על X-Forwarded-For (פריסה מאחורי Reverse Proxy) */
export function clientIp(headers: Headers) {
  if (process.env.TRUST_PROXY === "true") {
    const xf = headers.get("x-forwarded-for");
    if (xf) return xf.split(",")[0].trim();
    return headers.get("x-real-ip") ?? "unknown";
  }
  return "direct";
}

export async function registerUser(v: { fullName: string; email: string; password: string; domainIds: number[]; requestCross: boolean }) {
  const [exists] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${v.email}`);
  if (exists) throw new ApiError(409, "כתובת הדוא\"ל כבר רשומה במערכת");
  const valid = await db.select({ id: domains.id }).from(domains);
  const validIds = new Set(valid.map((d) => d.id));
  const domainIds = [...new Set(v.domainIds)].filter((id) => validIds.has(id));
  const passwordHash = await bcrypt.hash(v.password, 12);
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: v.email, fullName: v.fullName, passwordHash, status: "PENDING" }).returning();
    await tx.insert(approvalRequests).values({ userId: u.id, requestedDomainIds: domainIds, requestedCross: v.requestCross });
    await audit(tx, u.id, "user", u.id, "register", { domainIds, requestCross: v.requestCross }, "משתמש נרשם וממתין לאישור");
    return u;
  });
}

let DUMMY_HASH: string | undefined;
export async function verifyLogin(email: string, password: string) {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  // השוואה גם כשהמשתמש לא קיים — למניעת חשיפת קיום חשבון לפי זמן תגובה
  DUMMY_HASH ??= await bcrypt.hash("dummy-password-for-timing", 12);
  const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok) throw new ApiError(401, "דוא\"ל או סיסמה שגויים");
  return u;
}

export async function listUsersForAdmin() {
  const rows = await db.select({ u: users, req: approvalRequests }).from(users)
    .leftJoin(approvalRequests, eq(approvalRequests.userId, users.id)).orderBy(asc(users.createdAt));
  const perms = await db.select().from(userDomainPermissions);
  return rows.map(({ u, req }) => ({
    id: u.id, email: u.email, fullName: u.fullName, role: u.role, status: u.status, canEditCross: u.canEditCross,
    createdAt: u.createdAt.toISOString(), approvedAt: u.approvedAt?.toISOString() ?? null,
    domainIds: perms.filter((p) => p.userId === u.id).map((p) => p.domainId),
    request: req ? { domainIds: req.requestedDomainIds, cross: req.requestedCross, createdAt: req.createdAt.toISOString() } : null,
  }));
}

async function setPermissions(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], adminId: number, userId: number, domainIds: number[], canEditCross: boolean) {
  await tx.delete(userDomainPermissions).where(eq(userDomainPermissions.userId, userId));
  const ids = [...new Set(domainIds)];
  if (ids.length) await tx.insert(userDomainPermissions).values(ids.map((d) => ({ userId, domainId: d, grantedById: adminId })));
  await tx.update(users).set({ canEditCross, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function adminUserAction(admin: Me, userId: number, a:
  | { action: "approve"; domainIds: number[]; canEditCross: boolean }
  | { action: "reject" } | { action: "suspend" } | { action: "reactivate" }
  | { action: "setPermissions"; domainIds: number[]; canEditCross: boolean }
  | { action: "resetLink" }) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new ApiError(404, "המשתמש לא נמצא");
  if (u.role === "SUPER") throw new ApiError(400, "לא ניתן לשנות את חשבון מנהל המערכת");
  if ("domainIds" in a) {
    const valid = new Set((await db.select({ id: domains.id }).from(domains)).map((d) => d.id));
    if (a.domainIds.some((d) => !valid.has(d))) throw new ApiError(400, "תחום לא קיים");
  }
  // מעברי סטטוס מותרים
  const allowed: Record<string, string[]> = {
    approve: ["PENDING", "REJECTED"], reject: ["PENDING"], suspend: ["APPROVED"], reactivate: ["SUSPENDED"],
    setPermissions: ["APPROVED", "SUSPENDED"], resetLink: ["PENDING", "APPROVED", "SUSPENDED"],
  };
  if (!allowed[a.action].includes(u.status)) throw new ApiError(409, "הפעולה אינה מתאימה לסטטוס הנוכחי של המשתמש. רענן את המסך.");
  const killSessions = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => tx.delete(sessions).where(eq(sessions.userId, userId));
  return db.transaction(async (tx) => {
    const before = { status: u.status, canEditCross: u.canEditCross };
    switch (a.action) {
      case "approve":
        await tx.update(users).set({ status: "APPROVED", approvedAt: new Date(), approvedById: admin.id }).where(eq(users.id, userId));
        await setPermissions(tx, admin.id, userId, a.domainIds, a.canEditCross);
        await tx.update(approvalRequests).set({ decidedAt: new Date(), decidedById: admin.id }).where(eq(approvalRequests.userId, userId));
        await audit(tx, admin.id, "user", userId, "approve", { domainIds: a.domainIds, canEditCross: a.canEditCross, before }, `אושר משתמש ${u.fullName}`);
        return { ok: true };
      case "reject":
        await tx.update(users).set({ status: "REJECTED" }).where(eq(users.id, userId));
        await tx.update(approvalRequests).set({ decidedAt: new Date(), decidedById: admin.id }).where(eq(approvalRequests.userId, userId));
        await killSessions(tx);
        await audit(tx, admin.id, "user", userId, "reject", { before }, `נדחה משתמש ${u.fullName}`);
        return { ok: true };
      case "suspend":
        await tx.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, userId));
        await killSessions(tx);
        await audit(tx, admin.id, "user", userId, "suspend", { before }, `הושעה משתמש ${u.fullName}`);
        return { ok: true };
      case "reactivate":
        await tx.update(users).set({ status: "APPROVED", approvedAt: new Date(), approvedById: admin.id }).where(eq(users.id, userId));
        await audit(tx, admin.id, "user", userId, "reactivate", { before }, `הופעל מחדש משתמש ${u.fullName}`);
        return { ok: true };
      case "setPermissions": {
        const prev = await tx.select().from(userDomainPermissions).where(eq(userDomainPermissions.userId, userId));
        await setPermissions(tx, admin.id, userId, a.domainIds, a.canEditCross);
        await audit(tx, admin.id, "user", userId, "permissions", {
          domainIds: { from: prev.map((p) => p.domainId), to: a.domainIds },
          canEditCross: { from: u.canEditCross, to: a.canEditCross },
        }, `עודכנו הרשאות של ${u.fullName}`);
        return { ok: true };
      }
      case "resetLink": {
        const token = await createResetToken(userId, tx);
        await audit(tx, admin.id, "user", userId, "resetLink", null, `הופק קישור איפוס סיסמה עבור ${u.fullName}`);
        return { link: `${appUrl()}/reset?token=${token}` };
      }
    }
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function resetLinkFor(token: string) {
  return `${appUrl()}/reset?token=${token}`;
}

export async function createResetToken(userId: number, q: Pick<typeof db, "insert"> = db) {
  const token = randomToken();
  await q.insert(passwordResetTokens).values({ id: sha256(token), userId, expiresAt: new Date(Date.now() + 60 * 60000) });
  return token;
}

export async function requestPasswordReset(email: string) {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!u || u.status === "REJECTED") return; // לא חושפים אם החשבון קיים
  const token = await createResetToken(u.id);
  const link = `${appUrl()}/reset?token=${token}`;
  const sent = await sendMail(u.email, "איפוס סיסמה — תוכנית עבודה",
    `<div dir="rtl">שלום ${escapeHtml(u.fullName)},<br/>לאיפוס הסיסמה לחץ על הקישור (בתוקף לשעה):<br/><a href="${link}">${link}</a></div>`);
  if (!sent) {
    // הקישור עצמו נכתב ללוג רק בפיתוח או כשהוגדר במפורש — בייצור מנהל המערכת מפיק קישור ממסך הניהול
    if (process.env.NODE_ENV !== "production" || process.env.LOG_RESET_LINKS === "true") console.log(`[password-reset] ${u.email}: ${link}`);
    else console.log(`[password-reset] SMTP לא מוגדר — לא נשלח מייל ל-${u.email}. ניתן להפיק קישור איפוס ממסך ניהול המשתמשים.`);
  }
}

export async function resetPassword(token: string, password: string) {
  const id = sha256(token);
  const passwordHash = await bcrypt.hash(password, 12);
  await db.transaction(async (tx) => {
    // צריכה אטומית של הטוקן — שימוש חד-פעמי גם בבקשות מקבילות
    const [t] = await tx.update(passwordResetTokens).set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .returning({ userId: passwordResetTokens.userId });
    if (!t) throw new ApiError(400, "קישור האיפוס אינו תקף או שפג תוקפו");
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, t.userId));
    await tx.delete(sessions).where(eq(sessions.userId, t.userId));
    await audit(tx, t.userId, "user", t.userId, "passwordReset", null, "הסיסמה אופסה");
  });
}

/** שינוי סיסמה מתוך "הגדרות": דורש את הסיסמה הנוכחית. שאר החיבורים של המשתמש (מכשירים אחרים) מנותקים. */
export async function changePassword(me: Me, current: string, next: string, keepSessionId: string | null) {
  const [u] = await db.select().from(users).where(eq(users.id, me.id));
  if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new ApiError(400, "הסיסמה הנוכחית שגויה");
  if (current === next) throw new ApiError(400, "הסיסמה החדשה זהה לנוכחית");
  const passwordHash = await bcrypt.hash(next, 12);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, me.id));
    await tx.delete(sessions).where(keepSessionId ? and(eq(sessions.userId, me.id), sql`${sessions.id} <> ${keepSessionId}`) : eq(sessions.userId, me.id));
    await audit(tx, me.id, "user", me.id, "passwordChange", null, "המשתמש שינה סיסמה");
  });
}
