import { route, body } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { priorityCreateSchema } from "@/lib/validation";
import { createPriority } from "@/server/catalog";
export const POST = route(async (req) => {
  const me = await requireSuper();
  return createPriority(me, priorityCreateSchema.parse(await body(req)));
});
