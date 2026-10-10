import { redirect } from "next/navigation";
import { Clock, XCircle, PauseCircle } from "lucide-react";
import { getMe } from "@/server/auth";
import { AuthShell } from "@/components/AuthShell";
import { PendingActions } from "./PendingActions";
export const dynamic = "force-dynamic";
export default async function PendingPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.status === "APPROVED") redirect("/plan");
  const content = {
    PENDING: { icon: <Clock className="text-amber-500" size={28} />, title: "ההרשמה התקבלה בהצלחה", text: "החשבון שלך ממתין לאישור מנהל המערכת. לאחר האישור תוכל לצפות בתוכנית העבודה." },
    REJECTED: { icon: <XCircle className="text-red-500" size={28} />, title: "בקשת ההרשמה נדחתה", text: "לפרטים נוספים ניתן לפנות למנהל המערכת." },
    SUSPENDED: { icon: <PauseCircle className="text-ink-500" size={28} />, title: "הגישה לחשבון הושעתה", text: "לפרטים נוספים ניתן לפנות למנהל המערכת." },
  }[me.status as "PENDING" | "REJECTED" | "SUSPENDED"];
  return (
    <AuthShell title={content.title}>
      <div className="flex gap-3">
        <div className="shrink-0">{content.icon}</div>
        <div className="space-y-1 text-[13px] text-ink-700">
          <p>{content.text}</p>
          <p className="text-ink-500">מחובר כ: <span dir="ltr">{me.email}</span></p>
        </div>
      </div>
      <PendingActions />
    </AuthShell>
  );
}
