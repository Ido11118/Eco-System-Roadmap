"use client";
import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Check, Eye } from "lucide-react";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { api, ApiErr } from "@/lib/api";
import { FormError } from "@/components/AuthShell";

export function RegisterForm({ domains }: { domains: { id: number; name: string }[] }) {
  const [f, setF] = useState({ fullName: "", email: "", password: "", password2: "" });
  const [sel, setSel] = useState<number[]>([]);
  const [cross, setCross] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== f.password2) { setErr("הסיסמאות אינן תואמות"); return; }
    setBusy(true); setErr(null);
    try {
      await api("POST", "/api/auth/register", { fullName: f.fullName, email: f.email, password: f.password, domainIds: sel, requestCross: cross });
      window.location.href = "/pending";
    } catch (e) {
      setErr(e instanceof ApiErr ? e.message : "שגיאה");
      setBusy(false);
    }
  }
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <form onSubmit={submit} className="space-y-3.5">
      <FormError msg={err} />
      <div>
        <label className="label" htmlFor="fullName">שם מלא</label>
        <input id="fullName" className="input h-10" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="email">כתובת דוא&quot;ל</label>
        <input id="email" className="input h-10" dir="ltr" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="password">סיסמה</label>
          <PasswordInput id="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} show={show} onToggle={() => setShow((x) => !x)} />
          <p className="mt-1 text-[11px] text-ink-400">8 תווים לפחות</p>
        </div>
        <div>
          <label className="label" htmlFor="password2">אימות סיסמה</label>
          <PasswordInput id="password2" value={f.password2} onChange={(v) => setF({ ...f, password2: v })} show={show} onToggle={() => setShow((x) => !x)}
            status={!f.password2 ? undefined : f.password2 === f.password ? "match" : "mismatch"} />
          {f.password2 && f.password2 !== f.password && <p className="mt-1 text-[11px] text-red-600">הסיסמאות אינן תואמות</p>}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-start gap-2 rounded-md bg-brand-50 px-3 py-2 text-[12.5px] text-brand-900">
          <Eye size={15} className="mt-0.5 shrink-0" />
          <span>לאחר אישור החשבון תוכל <b>לצפות בכל תוכנית העבודה</b> — אין צורך לבקש זאת. כאן מסמנים רק את התחומים שבהם תרצה גם <b>לערוך</b>.</span>
        </div>
        <div className="label">תחומים שבהם מבוקשת הרשאת עריכה <span className="font-normal text-ink-400">(אופציונלי)</span></div>
        <div className="flex flex-wrap gap-1.5">
          {domains.map((d) => (
            <button type="button" key={d.id} onClick={() => toggle(d.id)}
              className={clsx("chip h-7 cursor-pointer transition", sel.includes(d.id) && "border-brand-500 bg-brand-50 text-brand-700")}>
              {sel.includes(d.id) && <Check size={12} />}{d.name}
            </button>
          ))}
        </div>
        <label className="mt-2.5 flex items-center gap-2 text-[13px] text-ink-700 cursor-pointer">
          <input type="checkbox" checked={cross} onChange={(e) => setCross(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          בקשת הרשאת עריכה למידע הרוחבי (גורמים משפיעים, מופעים ואבני דרך רוחביות)
        </label>
        <p className="mt-1.5 text-[12px] text-ink-400">הבחירה היא בקשה בלבד. ההרשאות בפועל ייקבעו על ידי מנהל המערכת.</p>
      </div>
      <button className="btn-primary h-10 w-full" disabled={busy}>{busy ? "נרשם…" : "הרשמה"}</button>
      <p className="pt-1 text-center text-[13px] text-ink-500">
        כבר רשום? <Link href="/login" className="font-medium text-brand-600 hover:underline">להתחברות</Link>
      </p>
    </form>
  );
}
