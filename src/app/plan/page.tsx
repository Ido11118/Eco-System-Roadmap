import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getMe } from "@/server/auth";
import { PlanApp } from "@/components/plan/PlanApp";
export const dynamic = "force-dynamic";
export default async function PlanPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.status !== "APPROVED") redirect("/pending");
  return <Suspense><PlanApp me={me} /></Suspense>;
}
