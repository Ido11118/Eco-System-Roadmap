import { route, body, intParam } from "@/server/errors";
import { requireApproved, requireSuper } from "@/server/auth";
import { snapshotRevisionSchema } from "@/lib/validation";
import { listRevisions, saveRevision } from "@/server/snapshots";
import type { PlanData } from "@/lib/types";
export const GET = route(async (_req, ctx) => {
  await requireApproved();
  return listRevisions(intParam((await ctx.params).id));
});
export const POST = route(async (req, ctx) => {
  const me = await requireSuper();
  const v = snapshotRevisionSchema.parse(await body(req));
  return saveRevision(me, intParam((await ctx.params).id), v.baseRevisionId, v.note, v.data as PlanData);
});
