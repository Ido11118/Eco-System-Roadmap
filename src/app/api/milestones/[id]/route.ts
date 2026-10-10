import { route, body, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { milestonePatchSchema } from "@/lib/validation";
import { updateMilestone, deleteMilestone } from "@/server/plan";
export const PATCH = route(async (req, ctx) => {
  const me = await requireApproved();
  const v = milestonePatchSchema.parse(await body(req));
  return updateMilestone(me, intParam((await ctx.params).id), v.version, v.patch);
});
export const DELETE = route(async (_req, ctx) => {
  const me = await requireApproved();
  return deleteMilestone(me, intParam((await ctx.params).id));
});
