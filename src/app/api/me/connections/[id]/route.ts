import { z } from "zod";
import { route, body, intParam, ApiError } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { revokeConnection, setConnectionAccess } from "@/server/oauth";

// שינוי רמת הגישה של חיבור (קריאה בלבד / קריאה ועריכה) — חל מיד, גם על מפתחות שכבר הונפקו
export const PATCH = route(async (req, ctx) => {
  const me = await requireApproved();
  const { access } = z.object({ access: z.enum(["read", "write"]) }).parse(await body(req));
  if (!(await setConnectionAccess(me, intParam((await ctx.params).id), access))) throw new ApiError(404, "החיבור לא נמצא");
  return { ok: true };
});

// ניתוק: ביטול החיבור וכל המפתחות שלו
export const DELETE = route(async (_req, ctx) => {
  const me = await requireApproved();
  if (!(await revokeConnection(me, intParam((await ctx.params).id)))) throw new ApiError(404, "החיבור לא נמצא");
  return { ok: true };
});
