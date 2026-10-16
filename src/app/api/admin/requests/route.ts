import { route } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { listOpenRequests } from "@/server/requests";
export const GET = route(async () => { await requireSuper(); return listOpenRequests(); });
