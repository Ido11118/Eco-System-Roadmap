import "server-only";
import nodemailer from "nodemailer";

/** שליחת מייל אם SMTP מוגדר. מחזיר false אם לא נשלח. */
export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
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
