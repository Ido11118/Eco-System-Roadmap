import { route } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { loadPlan } from "@/server/plan";
export const GET = route(async () => {
  await requireApproved();
  return loadPlan();
});
