import { z } from "zod";
import { route, body } from "@/server/errors";
import { requireApproved, requireSuper } from "@/server/auth";
import { listDeletedItems, purgeDeletedItems } from "@/server/plan";
export const GET = route(async () => listDeletedItems(await requireApproved()));
// מחיקה לצמיתות (מנהל המערכת בלבד) — כולל בחירה מרובה
export const DELETE = route(async (req) => {
  const me = await requireSuper();
  const v = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }).parse(await body(req));
  return purgeDeletedItems(me, v.ids);
});
