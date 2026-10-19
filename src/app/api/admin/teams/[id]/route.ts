import { route, body, intParam } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { teamRenameSchema } from "@/lib/validation";
import { archiveTeam, renameTeam } from "@/server/structure";
export const PATCH = route(async (req, ctx) => {
  const me = await requireSuper();
  return renameTeam(me, intParam((await ctx.params).id), teamRenameSchema.parse(await body(req)).name);
});
export const DELETE = route(async (_req, ctx) => archiveTeam(await requireSuper(), intParam((await ctx.params).id)));
