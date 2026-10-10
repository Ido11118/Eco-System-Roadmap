import { redirect } from "next/navigation";
import { getMe } from "@/server/auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.status !== "APPROVED") redirect("/pending");
  redirect("/plan");
}
