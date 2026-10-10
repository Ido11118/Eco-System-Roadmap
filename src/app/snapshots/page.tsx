import { redirect } from "next/navigation";
import { getMe } from "@/server/auth";
import { SnapshotsApp } from "./SnapshotsApp";
export const dynamic = "force-dynamic";
export default async function SnapshotsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.status !== "APPROVED") redirect("/pending");
  return <SnapshotsApp me={me} />;
}
