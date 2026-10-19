import { route, body } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { teamCreateSchema } from "@/lib/validation";
import { createTeam } from "@/server/structure";
export const POST = route(async (req) => {
  const me = await requireSuper();
  const v = teamCreateSchema.parse(await body(req));
  return createTeam(me, v.domainId, v.name);
});
