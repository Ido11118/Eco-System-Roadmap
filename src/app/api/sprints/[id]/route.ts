import { route, body, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { sprintPatchSchema } from "@/lib/validation";
import { updateSprint, deleteSprint } from "@/server/plan";
export const PATCH = route(async (req, ctx) => {
  const me = await requireApproved();
  const v = sprintPatchSchema.parse(await body(req));
  return updateSprint(me, intParam((await ctx.params).id), v.version, v.patch);
});
export const DELETE = route(async (_req, ctx) => {
  const me = await requireApproved();
  return deleteSprint(me, intParam((await ctx.params).id));
});
