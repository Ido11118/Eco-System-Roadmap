import { route, body } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { statusCreateSchema } from "@/lib/validation";
import { createStatus } from "@/server/catalog";
export const POST = route(async (req) => {
  const me = await requireSuper();
  return createStatus(me, statusCreateSchema.parse(await body(req)));
});
