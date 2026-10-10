import { route, body, intParam, ApiError } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { updateItemSchema } from "@/lib/validation";
import { updateItem, deleteItem } from "@/server/plan";
export const PATCH = route(async (req, ctx) => {
  const me = await requireApproved();
  const v = updateItemSchema.parse(await body(req));
  return updateItem(me, intParam((await ctx.params).id), v.version, v.patch);
});
export const DELETE = route(async (req, ctx) => {
  const me = await requireApproved();
  const v = req.nextUrl.searchParams.get("version");
  if (v !== null && !Number.isInteger(Number(v))) throw new ApiError(400, "גרסה לא תקינה");
  return deleteItem(me, intParam((await ctx.params).id), v !== null ? Number(v) : undefined);
});
