import { redirect } from "next/navigation";
import { getMe } from "@/server/auth";
import { validateAuthorize } from "@/server/oauth";
import { isKnownAiHost, redirectHost } from "@/lib/oauth";
import { AuthShell, FormError } from "@/components/AuthShell";
import { ConsentForm } from "./ConsentForm";
export const dynamic = "force-dynamic";

// מסך האישור: עוזר AI מבקש גישה לתוכנית העבודה בשם המשתמש
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  // קודם התחברות — רק אחר כך בדיקת הלקוח (שעלולה לכלול קריאה לרשת). כך אנונימיים לא יכולים לגרום לשרת לשלוח בקשות
  const me = await getMe();
  if (!me) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, x]) => x !== undefined) as [string, string][]);
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }
  const v = await validateAuthorize(params);
  if (!v.ok && "redirect" in v) redirect(v.redirect);
  if (!v.ok) {
    return <AuthShell title="לא ניתן לחבר"><FormError msg={v.message} /></AuthShell>;
  }
  if (me.status !== "APPROVED") {
    return <AuthShell title="לא ניתן לחבר"><FormError msg="החשבון שלך עדיין לא אושר על ידי מנהל המערכת. אחרי האישור אפשר יהיה לחבר עוזר AI." /></AuthShell>;
  }
  return (
    <AuthShell title="חיבור עוזר AI" subtitle={`מחובר בתור ${me.fullName} (${me.email})`}>
      <ConsentForm params={params} clientName={v.req.clientName} host={redirectHost(v.req.redirectUri)} knownHost={isKnownAiHost(redirectHost(v.req.redirectUri))} canWrite={v.req.canWrite} />
    </AuthShell>
  );
}
