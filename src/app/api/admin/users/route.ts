import { route } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { listUsersForAdmin } from "@/server/users";
export const GET = route(async () => { await requireSuper(); return listUsersForAdmin(); });
