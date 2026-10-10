import { route, intParam } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { deleteRow } from "@/server/plan";
export const DELETE = route(async (req, ctx) => {
  const me = await requireApproved();
  return deleteRow(me, intParam((await ctx.params).id), { ifEmpty: req.nextUrl.searchParams.get("ifEmpty") === "1" });
});
