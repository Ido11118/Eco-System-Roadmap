"use client";
import { useState } from "react";
import clsx from "clsx";
import { Bot, Eye, Pencil } from "lucide-react";
import { api, ApiErr } from "@/lib/api";
import { FormError } from "@/components/AuthShell";

type Choice = "read" | "write";

export function ConsentForm({ params, clientName, host, canWrite }: {
  params: Record<string, string | undefined>; clientName: string; host: string; canWrite: boolean;
}) {
  const [choice, setChoice] = useState<Choice>("read");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (decision: Choice | "deny") => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ redirect: string }>("POST", "/api/oauth/authorize", { params, decision });
      window.location.href = r.redirect;
    } catch (e) {
      setErr(e instanceof ApiErr ? e.message : "שגיאה");
      setBusy(false);
    }
  };
  const opts: { key: Choice; icon: React.ReactNode; title: string; text: string; disabled?: boolean }[] = [
    { key: "read", icon: <Eye size={16} />, title: "קריאה בלבד", text: "צפייה בגאנט, בתכולות, באבני הדרך, בספרינטים ובבאקלוג." },
    {
      key: "write", icon: <Pencil size={16} />, title: "קריאה ועריכה", disabled: !canWrite,
      text: canWrite ? "גם הוספה ועדכון של תכולות, אבני דרך, ספרינטים ובאקלוג. מחיקה לא אפשרית." : "הלקוח ביקש גישת קריאה בלבד.",
    },
  ];
  return (
    <div className="space-y-4" data-testid="consent">
      <FormError msg={err} />
      <div className="flex items-start gap-3 rounded-lg bg-ink-50 p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><Bot size={18} /></span>
        <div className="min-w-0 text-[13px]">
          <div className="font-semibold text-ink-900"><bdi>{clientName}</bdi> מבקש גישה לתוכנית העבודה בשמך</div>
          <div className="mt-0.5 text-ink-500">חזרה אל: <bdi dir="ltr" className="font-medium text-ink-700">{host}</bdi></div>
        </div>
      </div>
      <div className="space-y-2" role="radiogroup" aria-label="רמת גישה">
        {opts.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={choice === o.key} disabled={o.disabled || busy}
            onClick={() => setChoice(o.key)} data-value={o.key}
            className={clsx("flex w-full items-start gap-3 rounded-lg border p-3 text-start transition disabled:opacity-50",
              choice === o.key ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:bg-ink-50")}>
            <span className={clsx("mt-0.5", choice === o.key ? "text-brand-600" : "text-ink-400")}>{o.icon}</span>
            <span>
              <span className="block text-[13.5px] font-semibold text-ink-900">{o.title}</span>
              <span className="block text-[12.5px] text-ink-500">{o.text}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-[12px] text-ink-500">
        העוזר יפעל עם ההרשאות שלך בלבד (עריכה רק בתחומים שמותרים לך), וכל שינוי יירשם בהיסטוריה בשמך.
        אפשר לשנות את רמת הגישה או לנתק בכל רגע ב<b>הגדרות ← חיבורי AI</b>.
      </p>
      <div className="flex gap-2">
        <button className="btn-primary h-10 flex-1" disabled={busy} onClick={() => void decide(choice)} data-testid="consent-approve">{busy ? "מאשר…" : "אישור וחיבור"}</button>
        <button className="btn-secondary h-10" disabled={busy} onClick={() => void decide("deny")} data-testid="consent-deny">ביטול</button>
      </div>
    </div>
  );
}
