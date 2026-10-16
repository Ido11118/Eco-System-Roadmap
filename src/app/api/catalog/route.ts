import { route } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { loadCatalogData } from "@/server/catalog";
export const GET = route(async () => { await requireApproved(); return loadCatalogData(); });
