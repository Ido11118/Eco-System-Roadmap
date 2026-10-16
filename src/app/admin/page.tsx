import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { getMe } from "@/server/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { AdminApp } from "./AdminApp";
import { CatalogProvider } from "@/components/CatalogProvider";
import { loadCatalogData } from "@/server/catalog";
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.status !== "APPROVED") redirect("/pending");
  if (me.role !== "SUPER") redirect("/plan");
  const ds = await db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(asc(domains.sortOrder));
  return <CatalogProvider initial={await loadCatalogData()}><AdminApp me={me} domains={ds} /></CatalogProvider>;
}
