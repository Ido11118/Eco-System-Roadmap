import { route, ApiError } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { itemHistory } from "@/server/plan";
export const GET = route(async (req) => {
  await requireApproved();
  const t = req.nextUrl.searchParams.get("type") ?? "";
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!["item", "milestone", "sprint", "row"].includes(t) || !Number.isInteger(id)) throw new ApiError(400, "בקשה לא תקינה");
  return itemHistory(t, id);
});
