import { route, body } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { priorityPatchSchema } from "@/lib/validation";
import { updatePriority, deletePriority } from "@/server/catalog";
export const PATCH = route(async (req, ctx) => {
  const me = await requireSuper();
  return updatePriority(me, (await ctx.params).key, priorityPatchSchema.parse(await body(req)));
});
export const DELETE = route(async (req, ctx) => {
  const me = await requireSuper();
  return deletePriority(me, (await ctx.params).key, req.nextUrl.searchParams.get("replaceWith") ?? undefined);
});
