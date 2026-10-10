"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiErr } from "@/lib/api";
import { AuthShell, FormError } from "@/components/AuthShell";
function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [p1, setP1] = useState(""); const [p2, setP2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (p1 !== p2) { setErr("הסיסמאות אינן תואמות"); return; }
    try { await api("POST", "/api/auth/reset", { token, password: p1 }); setDone(true); }
    catch (e) { setErr(e instanceof ApiErr ? e.message : "שגיאה"); }
  }
  if (done) return (
    <div className="space-y-4 text-[13px]">
      <p>הסיסמה עודכנה בהצלחה.</p>
      <Link href="/login" className="btn-primary w-full">להתחברות</Link>
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-3.5">
      <FormError msg={err} />
      <div><label className="label">סיסמה חדשה</label><input className="input h-10" dir="ltr" type="password" minLength={8} required value={p1} onChange={(e) => setP1(e.target.value)} /></div>
      <div><label className="label">אימות סיסמה</label><input className="input h-10" dir="ltr" type="password" minLength={8} required value={p2} onChange={(e) => setP2(e.target.value)} /></div>
      <button className="btn-primary h-10 w-full">עדכון סיסמה</button>
    </form>
  );
}
export default function ResetPage() {
  return <AuthShell title="איפוס סיסמה"><Suspense><ResetForm /></Suspense></AuthShell>;
}
