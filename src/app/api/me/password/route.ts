import { route, body } from "@/server/errors";
import { requireApproved, currentSessionId } from "@/server/auth";
import { changePasswordSchema } from "@/lib/validation";
import { changePassword, rateLimit } from "@/server/users";
export const POST = route(async (req) => {
  const me = await requireApproved();
  rateLimit(`pwchange:${me.id}`, 10);
  const v = changePasswordSchema.parse(await body(req));
  await changePassword(me, v.current, v.next, await currentSessionId());
  return { ok: true };
});
