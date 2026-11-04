"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiErr } from "@/lib/api";
import { AuthShell, FormError } from "@/components/AuthShell";
import { PasswordInput } from "@/components/ui/PasswordInput";
function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [p1, setP1] = useState(""); const [p2, setP2] = useState("");
  const [show, setShow] = useState(false);
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
      <div><label className="label" htmlFor="reset-p1">סיסמה חדשה</label><PasswordInput id="reset-p1" value={p1} onChange={setP1} show={show} onToggle={() => setShow((x) => !x)} /></div>
      <div><label className="label" htmlFor="reset-p2">אימות סיסמה</label>
        <PasswordInput id="reset-p2" value={p2} onChange={setP2} show={show} onToggle={() => setShow((x) => !x)} status={p2 ? (p1 === p2 ? "match" : "mismatch") : undefined} /></div>
      <button className="btn-primary h-10 w-full">עדכון סיסמה</button>
    </form>
  );
}
export default function ResetPage() {
  return <AuthShell title="איפוס סיסמה"><Suspense><ResetForm /></Suspense></AuthShell>;
}
