import { redirect } from "next/navigation";
import { getMe } from "@/server/auth";
import { SnapshotEditor } from "./SnapshotEditor";
import { CatalogProvider } from "@/components/CatalogProvider";
import { loadCatalogData } from "@/server/catalog";
import { getManageable } from "@/server/snapshots";
export const dynamic = "force-dynamic";
export default async function SnapshotEditPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.status !== "APPROVED") redirect("/pending");
  const { id } = await params;
  // עריכת תוכן: Snapshot משותף — מנהל המערכת; Snapshot אישי — בעליו
  const ok = await getManageable(me, Number(id)).then(() => true, () => false);
  if (!ok) redirect("/snapshots");
  return <CatalogProvider initial={await loadCatalogData()}><SnapshotEditor me={me} id={Number(id)} /></CatalogProvider>;
}
