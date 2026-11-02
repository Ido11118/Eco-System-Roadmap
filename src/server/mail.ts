import "server-only";
import nodemailer from "nodemailer";

/**
 * שליחת מייל. מחזיר false אם לא נשלח (לא מוגדר / נכשל) — לעולם לא זורק, כדי שכשל מייל לא יכשיל פעולה.
 * 1. Resend (RESEND_API_KEY) — דרך HTTPS. זו הדרך ב-Railway: בתוכניות Free/Trial/Hobby יציאת SMTP חסומה.
 *    בלי דומיין מאומת, Resend שולח רק לכתובת שאיתה נפתח החשבון — מספיק להתראות למנהל המערכת.
 * 2. SMTP (SMTP_HOST) — לשרת שמאפשר SMTP.
 */
export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (process.env.RESEND_API_KEY) return sendResend(to, subject, html);
  const host = process.env.SMTP_HOST;
  if (!host) return false;
  try {
    const t = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
    await t.sendMail({ from: process.env.SMTP_FROM ?? process.env.SMTP_USER, to, subject, html });
    return true;
  } catch (e) {
    console.error("[mail] failed", e);
    return false;
  }
}

async function sendResend(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const r = await fetch(`${process.env.RESEND_API_URL ?? "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM || "תוכנית עבודה <onboarding@resend.dev>", to: [to], subject, html }),
      signal: AbortSignal.timeout(8000), // שירות המייל איטי/לא זמין — לא מעכבים את המשתמש יותר מזה
    });
    if (!r.ok) { console.error("[mail] resend failed", r.status, (await r.text()).slice(0, 300)); return false; }
    return true;
  } catch (e) {
    console.error("[mail] resend failed", e);
    return false;
  }
}
