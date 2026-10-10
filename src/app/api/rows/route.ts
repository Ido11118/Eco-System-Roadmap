import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { createRowSchema } from "@/lib/validation";
import { createRow } from "@/server/plan";
export const POST = route(async (req) => {
  const me = await requireApproved();
  const v = createRowSchema.parse(await body(req));
  return createRow(me, v.teamId, v.anchorRowId, v.position);
});
