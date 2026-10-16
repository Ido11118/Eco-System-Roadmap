import { route, body, intParam } from "@/server/errors";
import { requireApproved, requireSuper } from "@/server/auth";
import { snapshotMetaSchema } from "@/lib/validation";
import { getSnapshotRevision, updateSnapshotMeta, deleteSnapshot } from "@/server/snapshots";
export const GET = route(async (req, ctx) => {
  await requireApproved();
  const rev = req.nextUrl.searchParams.get("rev");
  return getSnapshotRevision(intParam((await ctx.params).id), rev ? intParam(rev) : undefined);
});
export const PATCH = route(async (req, ctx) => {
  const me = await requireSuper();
  const v = snapshotMetaSchema.parse(await body(req));
  return updateSnapshotMeta(me, intParam((await ctx.params).id), v);
});
export const DELETE = route(async (_req, ctx) => {
  const me = await requireSuper();
  return deleteSnapshot(me, intParam((await ctx.params).id));
});
