import { route, intParam, ApiError } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { adminRevokeConnection } from "@/server/oauth";
// ניתוק חיבור AI של משתמש ע"י מנהל המערכת — המפתחות מבוטלים מיד
export const DELETE = route(async (_req, ctx) => {
  const admin = await requireSuper();
  if (!(await adminRevokeConnection(admin, intParam((await ctx.params).id)))) throw new ApiError(404, "החיבור לא נמצא (ייתכן שכבר נותק)");
  return { ok: true };
});
