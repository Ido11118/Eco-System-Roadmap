import { route, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { restoreRow } from "@/server/plan";
export const POST = route(async (_req, ctx) => {
  const me = await requireApproved();
  return restoreRow(me, intParam((await ctx.params).id));
});
