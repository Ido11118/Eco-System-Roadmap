import { route, body, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { scheduleBacklogSchema } from "@/lib/validation";
import { scheduleBacklog } from "@/server/backlog";
export const POST = route(async (req, ctx) => {
  const me = await requireApproved();
  const v = scheduleBacklogSchema.parse(await body(req));
  return scheduleBacklog(me, intParam((await ctx.params).id), v.version, v.item);
});
