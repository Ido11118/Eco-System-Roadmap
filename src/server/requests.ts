import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { domains, userDomainPermissions, userRequests, users } from "@/db/schema";
import type { Me } from "@/lib/types";
import { ApiError } from "./errors";
import { audit } from "./plan";
import { createResetToken, resetLinkFor } from "./users";

// ---------------------------------------------------------------------------
// פניות משתמשים למנהל המערכת
// ---------------------------------------------------------------------------

/** פנייה פתוחה אחת לכל משתמש לכל סוג: פנייה חוזרת מעדכנת את הקיימת */
async function upsertOpen(userId: number, kind: "permissions" | "password_reset", v: { domainIds?: number[]; requestCross?: boolean; note?: string }) {
  return db.transaction(async (tx) => {
    const [open] = await tx.select().from(userRequests)
      .where(and(eq(userRequests.userId, userId), eq(userRequests.kind, kind), eq(userRequests.status, "open")));
    if (open) {
      const [u] = await tx.update(userRequests).set({ ...v, createdAt: new Date() }).where(eq(userRequests.id, open.id)).returning();
      return u;
    }
    const [n] = await tx.insert(userRequests).values({ userId, kind, ...v }).returning();
    return n;
  });
}

/** משתמש מבקש הרשאות עריכה נוספות (מתוך "הגדרות") */
export async function requestPermissions(me: Me, v: { domainIds: number[]; requestCross: boolean; note: string }) {
  if (me.role === "SUPER") throw new ApiError(400, "למנהל המערכת יש כבר את כל ההרשאות");
  const valid = new Set((await db.select({ id: domains.id }).from(domains)).map((d) => d.id));
  const wanted = [...new Set(v.domainIds)].filter((d) => valid.has(d) && !me.domainIds.includes(d));
  const cross = v.requestCross && !me.canEditCross;
  if (!wanted.length && !cross) throw new ApiError(400, "לא נבחרו הרשאות חדשות לבקש");
  const r = await upsertOpen(me.id, "permissions", { domainIds: wanted, requestCross: cross, note: v.note.trim().slice(0, 500) });
  await audit(db, me.id, "user", me.id, "requestPermissions", { domainIds: wanted, requestCross: cross }, "משתמש ביקש הרשאות עריכה נוספות");
  return { id: r.id };
}

/** "שכחתי סיסמה": פנייה למנהל המערכת. לא חושפים אם החשבון קיים. */
export async function requestPasswordResetFromAdmin(email: string) {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!u || u.status === "REJECTED") return;
  await upsertOpen(u.id, "password_reset", {});
  await audit(db, u.id, "user", u.id, "requestPasswordReset", null, "משתמש ביקש קישור לאיפוס סיסמה");
}

/** הפניות של המשתמש עצמו (לתצוגה במסך ההגדרות שלו) */
export async function myOpenRequests(me: Me) {
  return db.select({ id: userRequests.id, kind: userRequests.kind, domainIds: userRequests.domainIds, requestCross: userRequests.requestCross, createdAt: userRequests.createdAt })
    .from(userRequests).where(and(eq(userRequests.userId, me.id), eq(userRequests.status, "open")));
}

/** פניות פתוחות — למסך ניהול המערכת */
export async function listOpenRequests() {
  const rows = await db.select({ r: userRequests, fullName: users.fullName, email: users.email, userStatus: users.status, canEditCross: users.canEditCross })
    .from(userRequests).innerJoin(users, eq(users.id, userRequests.userId))
    .where(eq(userRequests.status, "open")).orderBy(desc(userRequests.createdAt));
  const ids = [...new Set(rows.map((x) => x.r.userId))];
  const perms = ids.length ? await db.select().from(userDomainPermissions).where(inArray(userDomainPermissions.userId, ids)) : [];
  return rows.map(({ r, ...u }) => ({
    id: r.id, kind: r.kind, userId: r.userId, domainIds: r.domainIds, requestCross: r.requestCross, note: r.note, createdAt: r.createdAt.toISOString(),
    user: { ...u, domainIds: perms.filter((p) => p.userId === r.userId).map((p) => p.domainId) },
  }));
}

export async function openRequestsCount() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(userRequests).where(eq(userRequests.status, "open"));
  return n;
}

/**
 * טיפול בפנייה ע"י מנהל המערכת:
 * הרשאות — approve (מוסיף את התחומים שנבחרו להרשאות הקיימות) / reject.
 * איפוס סיסמה — link (מפיק קישור חד-פעמי, הפנייה נסגרת) / dismiss.
 */
export async function handleRequest(admin: Me, id: number, a: { action: "approve"; domainIds: number[]; requestCross: boolean } | { action: "reject" } | { action: "link" } | { action: "dismiss" }) {
  const [r] = await db.select().from(userRequests).where(eq(userRequests.id, id));
  if (!r || r.status !== "open") throw new ApiError(409, "הפנייה כבר טופלה. רענן את המסך.");
  const [u] = await db.select().from(users).where(eq(users.id, r.userId));
  if (!u) throw new ApiError(404, "המשתמש לא נמצא");
  const close = (status: "approved" | "rejected" | "done") =>
    db.update(userRequests).set({ status, handledAt: new Date(), handledById: admin.id }).where(eq(userRequests.id, id));
  if (r.kind === "permissions") {
    if (a.action === "approve") {
      const valid = new Set((await db.select({ id: domains.id }).from(domains)).map((d) => d.id));
      const add = [...new Set(a.domainIds)].filter((d) => valid.has(d));
      await db.transaction(async (tx) => {
        if (add.length) await tx.insert(userDomainPermissions).values(add.map((d) => ({ userId: u.id, domainId: d, grantedById: admin.id }))).onConflictDoNothing();
        if (a.requestCross) await tx.update(users).set({ canEditCross: true, updatedAt: new Date() }).where(eq(users.id, u.id));
        await tx.update(userRequests).set({ status: "approved", handledAt: new Date(), handledById: admin.id }).where(eq(userRequests.id, id));
        await audit(tx, admin.id, "user", u.id, "permissions", { added: add, canEditCross: a.requestCross || undefined }, `אושרה בקשת הרשאות של ${u.fullName}`);
      });
      return { ok: true };
    }
    if (a.action === "reject") {
      await close("rejected");
      await audit(db, admin.id, "user", u.id, "rejectPermissions", null, `נדחתה בקשת הרשאות של ${u.fullName}`);
      return { ok: true };
    }
  }
  if (r.kind === "password_reset") {
    if (a.action === "link") {
      const token = await createResetToken(u.id);
      await close("done");
      await audit(db, admin.id, "user", u.id, "resetLink", null, `הופק קישור איפוס סיסמה עבור ${u.fullName} (לפי בקשה)`);
      return { link: resetLinkFor(token), email: u.email, fullName: u.fullName };
    }
    if (a.action === "dismiss") {
      await close("done");
      return { ok: true };
    }
  }
  throw new ApiError(400, "פעולה לא מתאימה לסוג הפנייה");
}
