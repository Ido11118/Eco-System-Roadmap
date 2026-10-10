import { redirect } from "next/navigation";
import { getMe } from "@/server/auth";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "./LoginForm";
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  const me = await getMe();
  if (me) redirect(me.status === "APPROVED" ? "/plan" : "/pending");
  return (
    <AuthShell title="התחברות" subtitle="ברוך הבא. התחבר כדי לצפות ולעדכן את תוכנית העבודה.">
      <LoginForm />
    </AuthShell>
  );
}
