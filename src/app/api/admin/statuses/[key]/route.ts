import { route, body } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { statusPatchSchema } from "@/lib/validation";
import { updateStatus, deleteStatus } from "@/server/catalog";
export const PATCH = route(async (req, ctx) => {
  const me = await requireSuper();
  return updateStatus(me, (await ctx.params).key, statusPatchSchema.parse(await body(req)));
});
export const DELETE = route(async (req, ctx) => {
  const me = await requireSuper();
  return deleteStatus(me, (await ctx.params).key, req.nextUrl.searchParams.get("replaceWith") ?? undefined);
});
