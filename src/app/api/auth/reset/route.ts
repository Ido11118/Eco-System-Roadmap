import { route, body } from "@/server/errors";
import { resetSchema } from "@/lib/validation";
import { resetPassword } from "@/server/users";
export const POST = route(async (req) => {
  const v = resetSchema.parse(await body(req));
  await resetPassword(v.token, v.password);
  return { ok: true };
});
