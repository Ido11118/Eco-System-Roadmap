import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { bulkItemsSchema } from "@/lib/validation";
import { bulkUpdateItems } from "@/server/plan";
export const POST = route(async (req) => {
  const me = await requireApproved();
  const v = bulkItemsSchema.parse(await body(req));
  return bulkUpdateItems(me, v.entries, v.patch);
});
