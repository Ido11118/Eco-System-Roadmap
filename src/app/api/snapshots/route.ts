import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { snapshotCreateSchema } from "@/lib/validation";
import { createSnapshot, listSnapshots } from "@/server/snapshots";
export const GET = route(async () => listSnapshots(await requireApproved()));
export const POST = route(async (req) => {
  const me = await requireApproved(); // ההרשאה לפי סוג ה-Snapshot נבדקת בשרת
  const v = snapshotCreateSchema.parse(await body(req));
  return createSnapshot(me, v.name, v.description, v.asOfDate, v.scope);
});
