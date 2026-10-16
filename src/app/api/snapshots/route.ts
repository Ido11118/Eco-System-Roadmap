import { route, body } from "@/server/errors";
import { requireApproved, requireSuper } from "@/server/auth";
import { snapshotCreateSchema } from "@/lib/validation";
import { createSnapshot, listSnapshots } from "@/server/snapshots";
export const GET = route(async () => { await requireApproved(); return listSnapshots(); });
export const POST = route(async (req) => {
  const me = await requireSuper();
  const v = snapshotCreateSchema.parse(await body(req));
  return createSnapshot(me, v.name, v.description, v.asOfDate);
});
