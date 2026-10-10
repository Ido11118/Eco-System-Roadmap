"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiErr } from "@/lib/api";
import { FormError } from "@/components/AuthShell";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api<{ status: string }>("POST", "/api/auth/login", { email, password });
      window.location.href = r.status === "APPROVED" ? "/plan" : "/pending";
    } catch (e) {
      setErr(e instanceof ApiErr ? e.message : "שגיאה");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3.5">
      <FormError msg={err} />
      <div>
        <label className="label" htmlFor="email">כתובת דוא&quot;ל</label>
        <input id="email" className="input h-10" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="password">סיסמה</label>
          <Link href="/forgot" className="mb-1 text-[12px] text-brand-600 hover:underline">שכחתי סיסמה</Link>
        </div>
        <input id="password" className="input h-10" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn-primary h-10 w-full" disabled={busy}>{busy ? "מתחבר…" : "התחברות"}</button>
      <p className="pt-1 text-center text-[13px] text-ink-500">
        אין לך חשבון? <Link href="/register" className="font-medium text-brand-600 hover:underline">להרשמה</Link>
      </p>
    </form>
  );
}
