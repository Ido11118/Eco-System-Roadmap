"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiErr } from "@/lib/api";
import { AuthShell, FormError } from "@/components/AuthShell";
export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { await api("POST", "/api/auth/forgot", { email }); setDone(true); }
    catch (e) { setErr(e instanceof ApiErr ? e.message : "שגיאה"); }
  }
  return (
    <AuthShell title="שחזור סיסמה" subtitle="נשלח קישור לאיפוס הסיסמה לכתובת הדוא״ל הרשומה.">
      {done ? (
        <div className="space-y-4 text-[13px] text-ink-700">
          <p>אם הכתובת רשומה במערכת, נשלח אליה קישור לאיפוס הסיסמה (בתוקף לשעה).</p>
          <p className="text-ink-500">לא התקבל מייל? ניתן לפנות למנהל המערכת, שיכול להפיק עבורך קישור איפוס.</p>
          <Link href="/login" className="btn-secondary w-full">חזרה להתחברות</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3.5">
          <FormError msg={err} />
          <div>
            <label className="label" htmlFor="email">כתובת דוא&quot;ל</label>
            <input id="email" className="input h-10" dir="ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn-primary h-10 w-full">שליחת קישור</button>
          <p className="text-center text-[13px]"><Link href="/login" className="text-brand-600 hover:underline">חזרה להתחברות</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
