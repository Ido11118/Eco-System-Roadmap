import "server-only";
// התראות במייל למנהל המערכת על פעולות שמחכות לו: הרשמה חדשה, בקשת הרשאות, פנייה לאיפוס סיסמה.
// לעולם לא מכשיל את הפעולה עצמה — אם המייל לא נשלח, הפנייה עדיין מופיעה בניהול מערכת (והתקלה נרשמת בלוג).
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { domains, users } from "@/db/schema";
import { adminNotifyHtml, type NotifyRow } from "@/lib/notifyTemplate";
import { sendMail } from "./mail";

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** לאן נשלחות ההתראות: ADMIN_NOTIFY_EMAIL, ואם לא הוגדר — כתובת מנהל המערכת */
async function adminEmail(): Promise<string | null> {
  if (process.env.ADMIN_NOTIFY_EMAIL) return process.env.ADMIN_NOTIFY_EMAIL;
  const [a] = await db.select({ email: users.email }).from(users).where(eq(users.role, "SUPER"));
  return a?.email ?? null;
}

async function domainNames(ids: number[], cross: boolean): Promise<string> {
  const names = ids.length ? (await db.select({ name: domains.name }).from(domains).where(inArray(domains.id, ids))).map((d) => d.name) : [];
  if (cross) names.push("רוחבי");
  return names.length ? names.join(", ") : "ללא (צפייה בלבד)";
}

async function notifyAdmin(subject: string, title: string, intro: string, rows: NotifyRow[]) {
  try {
    if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) return; // שליחת מיילים לא הוגדרה
    const to = await adminEmail();
    if (!to) return;
    const html = adminNotifyHtml({ title, intro, rows, ctaUrl: `${appUrl()}/admin`, ctaLabel: "מעבר לניהול מערכת" });
    if (!(await sendMail(to, subject, html))) console.error(`[notify] admin email not sent: ${subject}`);
  } catch (e) {
    console.error("[notify] failed", e);
  }
}

export async function notifyNewRegistration(u: { fullName: string; email: string }, domainIds: number[], cross: boolean) {
  await notifyAdmin(`הרשמה חדשה ממתינה לאישור: ${u.fullName}`, "משתמש חדש נרשם וממתין לאישור", "יש לאשר או לדחות את ההרשמה במסך ניהול המערכת.", [
    { label: "שם", value: u.fullName },
    { label: "דוא\"ל", value: u.email },
    { label: "ביקש עריכה ב", value: await domainNames(domainIds, cross) },
  ]);
}

export async function notifyPermissionRequest(u: { fullName: string; email: string }, domainIds: number[], cross: boolean, note: string) {
  await notifyAdmin(`בקשת הרשאות עריכה: ${u.fullName}`, "משתמש ביקש הרשאות עריכה נוספות", "אפשר לאשר או לדחות את הבקשה במסך ניהול המערכת.", [
    { label: "שם", value: u.fullName },
    { label: "דוא\"ל", value: u.email },
    { label: "מבקש עריכה ב", value: await domainNames(domainIds, cross) },
    { label: "הערה", value: note },
  ]);
}

export async function notifyPasswordResetRequest(u: { fullName: string; email: string }) {
  await notifyAdmin(`פנייה לאיפוס סיסמה: ${u.fullName}`, "משתמש ביקש קישור לאיפוס סיסמה", "אפשר להפיק קישור איפוס במסך ניהול המערכת ולשלוח אותו למשתמש.", [
    { label: "שם", value: u.fullName },
    { label: "דוא\"ל", value: u.email },
  ]);
}
