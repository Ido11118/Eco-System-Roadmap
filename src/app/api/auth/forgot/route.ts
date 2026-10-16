import { route, body } from "@/server/errors";
import { forgotSchema } from "@/lib/validation";
import { requestPasswordReset, rateLimit, clientIp } from "@/server/users";
import { requestPasswordResetFromAdmin } from "@/server/requests";
// "שכחתי סיסמה": נפתחת פנייה למנהל המערכת, שמפיק קישור איפוס ושולח אותו ידנית.
// אם הוגדר שרת מייל (SMTP) — נשלח בנוסף גם מייל עם קישור.
export const POST = route(async (req) => {
  const v = forgotSchema.parse(await body(req));
  rateLimit(`forgot:${v.email}`, 5);
  rateLimit(`forgot-ip:${clientIp(req.headers)}`, 30);
  await requestPasswordResetFromAdmin(v.email);
  if (process.env.SMTP_HOST) await requestPasswordReset(v.email);
  return { ok: true };
});
