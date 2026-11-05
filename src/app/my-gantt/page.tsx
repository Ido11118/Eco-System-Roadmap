import { redirect } from "next/navigation";
import { getMe } from "@/server/auth";
import { loadCatalogData } from "@/server/catalog";
import { CatalogProvider } from "@/components/CatalogProvider";
import { PersonalGanttApp } from "@/components/plan/PersonalGanttApp";

export const dynamic = "force-dynamic";
export default async function PersonalGanttPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.status !== "APPROVED") redirect("/pending");
  if (me.role !== "SUPER") redirect("/plan");
  return <CatalogProvider initial={await loadCatalogData()}><PersonalGanttApp me={me} /></CatalogProvider>;
}
