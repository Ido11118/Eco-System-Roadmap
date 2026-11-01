import { redirect } from "next/navigation";
import { getMe } from "@/server/auth";
import { googleConfig, safeNext } from "@/server/google";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "./LoginForm";
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = { google_off: "התחברות עם Google אינה מוגדרת במערכת" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const me = await getMe();
  if (me) redirect(me.status === "APPROVED" ? next ?? "/plan" : "/pending");
  const error = sp.error ? ERRORS[sp.error] ?? sp.error.slice(0, 200) : null;
  return (
    <AuthShell title="התחברות" subtitle={next?.startsWith("/oauth/") ? "התחבר כדי לאשר את החיבור לעוזר ה-AI." : "ברוך הבא. התחבר כדי לצפות ולעדכן את תוכנית העבודה."}>
      <LoginForm next={next} google={!!googleConfig()} initialError={error} />
    </AuthShell>
  );
}
