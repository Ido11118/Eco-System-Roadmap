import { route, body } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { teamOrderSchema } from "@/lib/validation";
import { reorderTeams } from "@/server/structure";
export const POST = route(async (req) => {
  const me = await requireSuper();
  const v = teamOrderSchema.parse(await body(req));
  return reorderTeams(me, v.domainId, v.teamIds);
});
