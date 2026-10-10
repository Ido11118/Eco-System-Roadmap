import { route, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { restoreItem } from "@/server/plan";
export const POST = route(async (_req, ctx) => {
  const me = await requireApproved();
  return restoreItem(me, intParam((await ctx.params).id));
});
