import { z } from "zod";
import { route, body, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { restoreRevision } from "@/server/snapshots";
export const POST = route(async (req, ctx) => {
  const me = await requireApproved(); // ההרשאה לפי סוג ה-Snapshot נבדקת בשרת
  const v = z.object({ revisionId: z.number().int().positive() }).parse(await body(req));
  return restoreRevision(me, intParam((await ctx.params).id), v.revisionId);
});
