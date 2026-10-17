import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { importSchema } from "@/lib/validation";
import { importPlan } from "@/server/aiImport";
export const POST = route(async (req) => {
  const me = await requireApproved();
  return importPlan(me, importSchema.parse(await body(req)));
});
