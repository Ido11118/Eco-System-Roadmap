import { route } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { loadStructure } from "@/server/structure";
export const GET = route(async () => loadStructure(await requireSuper()));
