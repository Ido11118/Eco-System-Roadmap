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
    <AuthShell title="שכחתי סיסמה" subtitle="הבקשה תישלח למנהל המערכת, שישלח לך קישור לאיפוס הסיסמה.">
      {done ? (
        <div className="space-y-4 text-[13px] text-ink-700" data-testid="forgot-done">
          <p className="rounded-md bg-green-50 px-3 py-2 text-green-800">הבקשה נשלחה למנהל המערכת.</p>
          <p>מנהל המערכת יפיק עבורך <b>קישור לאיפוס סיסמה</b> וישלח אותו אליך (למשל בוואטסאפ או במייל). הקישור בתוקף לשעה ולשימוש אחד.</p>
          <p className="text-ink-500">אם לא קיבלת קישור תוך זמן סביר — פנה ישירות למנהל המערכת.</p>
          <Link href="/login" className="btn-secondary w-full">חזרה להתחברות</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3.5">
          <FormError msg={err} />
          <p className="rounded-md bg-brand-50 px-3 py-2 text-[12.5px] text-brand-900">
            פנה למנהל המערכת לקבלת קישור לאיפוס סיסמה: הזן את כתובת הדוא&quot;ל שלך, והבקשה תופיע אצלו.
          </p>
          <div>
            <label className="label" htmlFor="email">כתובת דוא&quot;ל</label>
            <input id="email" className="input h-10" dir="ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn-primary h-10 w-full">שליחת בקשה למנהל המערכת</button>
          <p className="text-center text-[13px]"><Link href="/login" className="text-brand-600 hover:underline">חזרה להתחברות</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
