import { redirect } from "next/navigation";
import { getMe } from "@/server/auth";
import { SnapshotEditor } from "./SnapshotEditor";
export const dynamic = "force-dynamic";
export default async function SnapshotEditPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.status !== "APPROVED") redirect("/pending");
  if (me.role !== "SUPER") redirect("/snapshots");
  const { id } = await params;
  return <SnapshotEditor me={me} id={Number(id)} />;
}
