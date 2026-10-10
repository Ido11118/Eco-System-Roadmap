import { route, body, ApiError } from "@/server/errors";
import { loginSchema } from "@/lib/validation";
import { verifyLogin, rateLimit, assertNotLimited, clientIp } from "@/server/users";
import { createSession } from "@/server/auth";

const PER_ACCOUNT = 10; // כישלונות לחשבון+כתובת ב-10 דקות
const PER_IP = 50; // כישלונות לכתובת ב-10 דקות (Password spraying)

export const POST = route(async (req) => {
  const v = loginSchema.parse(await body(req));
  const ip = clientIp(req.headers);
  const kAcc = `login:${v.email}:${ip}`, kIp = `login-ip:${ip}`;
  assertNotLimited(kAcc, PER_ACCOUNT);
  if (ip !== "direct") assertNotLimited(kIp, PER_IP);
  let u;
  try {
    u = await verifyLogin(v.email, v.password);
  } catch (e) {
    // רק ניסיונות כושלים נספרים — משתמש לגיטימי לא ננעל בגלל התחברויות תקינות
    rateLimit(kAcc, PER_ACCOUNT + 1);
    if (ip !== "direct") rateLimit(kIp, PER_IP + 1);
    throw e;
  }
  if (u.status === "REJECTED") throw new ApiError(403, "בקשת ההרשמה נדחתה. לפרטים פנה למנהל המערכת.");
  if (u.status === "SUSPENDED") throw new ApiError(403, "הגישה לחשבון הושעתה. לפרטים פנה למנהל המערכת.");
  await createSession(u.id);
  return { ok: true, status: u.status };
});
