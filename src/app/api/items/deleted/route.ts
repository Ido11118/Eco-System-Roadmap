import { route } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { listDeletedItems } from "@/server/plan";
export const GET = route(async () => listDeletedItems(await requireApproved()));
