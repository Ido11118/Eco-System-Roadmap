import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { createBacklogSchema } from "@/lib/validation";
import { createBacklog, listBacklog } from "@/server/backlog";
export const GET = route(async () => listBacklog(await requireApproved()));
export const POST = route(async (req) => {
  const me = await requireApproved();
  return createBacklog(me, createBacklogSchema.parse(await body(req)));
});
