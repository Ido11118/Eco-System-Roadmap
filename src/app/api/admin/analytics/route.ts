import { route, ApiError } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { isISODate } from "@/lib/weeks";
import { loadAnalytics } from "@/server/analytics";
export const GET = route(async (req) => {
  const me = await requireSuper();
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? "", to = u.searchParams.get("to") ?? "";
  if (!isISODate(from) || !isISODate(to)) throw new ApiError(400, "טווח תאריכים לא תקין");
  return loadAnalytics(me, from, to);
});
