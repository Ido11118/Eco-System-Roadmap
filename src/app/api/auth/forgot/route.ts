import { route, body } from "@/server/errors";
import { forgotSchema } from "@/lib/validation";
import { requestPasswordReset, rateLimit, clientIp } from "@/server/users";
export const POST = route(async (req) => {
  const v = forgotSchema.parse(await body(req));
  rateLimit(`forgot:${v.email}`, 5);
  rateLimit(`forgot-ip:${clientIp(req.headers)}`, 30);
  await requestPasswordReset(v.email);
  return { ok: true };
});
