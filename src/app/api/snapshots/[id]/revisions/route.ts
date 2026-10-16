import { route, body, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { snapshotRevisionSchema } from "@/lib/validation";
import { listRevisions, saveRevision } from "@/server/snapshots";
import type { PlanData } from "@/lib/types";
export const GET = route(async (_req, ctx) => {
  const me = await requireApproved();
  return listRevisions(me, intParam((await ctx.params).id));
});
export const POST = route(async (req, ctx) => {
  const me = await requireApproved(); // ההרשאה לפי סוג ה-Snapshot נבדקת בשרת
  const v = snapshotRevisionSchema.parse(await body(req));
  return saveRevision(me, intParam((await ctx.params).id), v.baseRevisionId, v.note, v.data as PlanData);
});
