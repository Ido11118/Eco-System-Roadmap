import { route, body, intParam } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { handleRequestSchema } from "@/lib/validation";
import { handleRequest } from "@/server/requests";
export const POST = route(async (req, ctx) => {
  const me = await requireSuper();
  return handleRequest(me, intParam((await ctx.params).id), handleRequestSchema.parse(await body(req)));
});
