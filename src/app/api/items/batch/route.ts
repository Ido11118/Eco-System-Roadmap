import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { batchItemsSchema } from "@/lib/validation";
import { batchItems } from "@/server/plan";

export const POST = route(async (req) => {
  const me = await requireApproved();
  const v = batchItemsSchema.parse(await body(req));
  return batchItems(me, v.action, v.entries);
});
