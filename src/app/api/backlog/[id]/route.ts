import { route, body, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { updateBacklogSchema } from "@/lib/validation";
import { deleteBacklog, updateBacklog } from "@/server/backlog";
export const PATCH = route(async (req, ctx) => {
  const me = await requireApproved();
  const v = updateBacklogSchema.parse(await body(req));
  return updateBacklog(me, intParam((await ctx.params).id), v.version, v.patch);
});
export const DELETE = route(async (_req, ctx) => deleteBacklog(await requireApproved(), intParam((await ctx.params).id)));
