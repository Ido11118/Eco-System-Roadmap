import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { createItemSchema } from "@/lib/validation";
import { createItem } from "@/server/plan";
export const POST = route(async (req) => {
  const me = await requireApproved();
  return createItem(me, createItemSchema.parse(await body(req)));
});
