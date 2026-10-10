import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { milestoneSchema } from "@/lib/validation";
import { createMilestone } from "@/server/plan";
export const POST = route(async (req) => {
  const me = await requireApproved();
  return createMilestone(me, milestoneSchema.parse(await body(req)));
});
