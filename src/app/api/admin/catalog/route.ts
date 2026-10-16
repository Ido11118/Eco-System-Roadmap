import { route } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { catalogUsage, loadCatalogData } from "@/server/catalog";
import { fileSyncEnabled } from "@/server/catalogSync";
export const GET = route(async () => {
  await requireSuper();
  const [data, usage] = await Promise.all([loadCatalogData(), catalogUsage()]);
  return { ...data, usage, fileSync: fileSyncEnabled() };
});
