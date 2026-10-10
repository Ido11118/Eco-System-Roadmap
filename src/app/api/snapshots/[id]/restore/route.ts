import { z } from "zod";
import { route, body, intParam } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { restoreRevision } from "@/server/snapshots";
export const POST = route(async (req, ctx) => {
  const me = await requireSuper();
  const v = z.object({ revisionId: z.number().int().positive() }).parse(await body(req));
  return restoreRevision(me, intParam((await ctx.params).id), v.revisionId);
});
