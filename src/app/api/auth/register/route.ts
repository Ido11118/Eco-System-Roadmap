import { route, body } from "@/server/errors";
import { registerSchema } from "@/lib/validation";
import { registerUser, rateLimit, clientIp } from "@/server/users";
import { createSession } from "@/server/auth";

export const POST = route(async (req) => {
  rateLimit(`reg:${clientIp(req.headers)}`, clientIp(req.headers) === "direct" ? 100 : 10);
  const v = registerSchema.parse(await body(req));
  const u = await registerUser(v);
  await createSession(u.id);
  return { ok: true, status: u.status };
});
