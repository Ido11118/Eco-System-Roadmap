import { route, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { deleteMilestone } from "@/server/plan";
export const POST = route(async (_req, ctx) => {
  const me = await requireApproved();
  return deleteMilestone(me, intParam((await ctx.params).id), true);
});
