import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { importUndoSchema } from "@/lib/validation";
import { undoImport } from "@/server/aiImport";
export const POST = route(async (req) => {
  const me = await requireApproved();
  return undoImport(me, importUndoSchema.parse(await body(req)));
});
