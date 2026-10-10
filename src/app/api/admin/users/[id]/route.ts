import { route, body, intParam } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { adminUserActionSchema } from "@/lib/validation";
import { adminUserAction } from "@/server/users";
export const POST = route(async (req, ctx) => {
  const me = await requireSuper();
  return adminUserAction(me, intParam((await ctx.params).id), adminUserActionSchema.parse(await body(req)));
});
