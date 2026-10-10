import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { sprintSchema } from "@/lib/validation";
import { createSprint } from "@/server/plan";
export const POST = route(async (req) => {
  const me = await requireApproved();
  return createSprint(me, sprintSchema.parse(await body(req)));
});
