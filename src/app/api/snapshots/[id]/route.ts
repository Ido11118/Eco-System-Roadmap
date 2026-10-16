import { route, body, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { snapshotMetaSchema } from "@/lib/validation";
import { getSnapshotRevision, updateSnapshotMeta, deleteSnapshot } from "@/server/snapshots";
export const GET = route(async (req, ctx) => {
  const me = await requireApproved();
  const rev = req.nextUrl.searchParams.get("rev");
  return getSnapshotRevision(me, intParam((await ctx.params).id), rev ? intParam(rev) : undefined);
});
export const PATCH = route(async (req, ctx) => {
  const me = await requireApproved(); // ההרשאה לפי סוג ה-Snapshot נבדקת בשרת
  const v = snapshotMetaSchema.parse(await body(req));
  return updateSnapshotMeta(me, intParam((await ctx.params).id), v);
});
export const DELETE = route(async (_req, ctx) => {
  const me = await requireApproved(); // ההרשאה לפי סוג ה-Snapshot נבדקת בשרת
  return deleteSnapshot(me, intParam((await ctx.params).id));
});
