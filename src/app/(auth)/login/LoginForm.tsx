"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiErr } from "@/lib/api";
import { FormError } from "@/components/AuthShell";
import { PasswordInput } from "@/components/ui/PasswordInput";

export function LoginForm({ next, google, initialError }: { next: string | null; google: boolean; initialError: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api<{ status: string }>("POST", "/api/auth/login", { email, password });
      window.location.href = r.status === "APPROVED" ? next ?? "/plan" : "/pending";
    } catch (e) {
      setErr(e instanceof ApiErr ? e.message : "שגיאה");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3.5">
      <FormError msg={err} />
      {google && <>
        <a href={`/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="btn-secondary h-10 w-full" data-testid="google-login">
          <GoogleIcon />התחברות עם Google
        </a>
        <div className="flex items-center gap-2 text-[12px] text-ink-400"><span className="h-px flex-1 bg-ink-200" />או עם דוא&quot;ל וסיסמה<span className="h-px flex-1 bg-ink-200" /></div>
      </>}
      <div>
        <label className="label" htmlFor="email">כתובת דוא&quot;ל</label>
        <input id="email" className="input h-10" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="password">סיסמה</label>
          <Link href="/forgot" className="mb-1 text-[12px] text-brand-600 hover:underline">שכחתי סיסמה</Link>
        </div>
        {/* עין להצגת הסיסמה שהוקלדה. בלי דרישת אורך מינימלי בהתחברות — הבדיקה בשרת */}
        <PasswordInput id="password" value={password} onChange={setPassword} show={show} onToggle={() => setShow((x) => !x)} autoComplete="current-password" minLength={1} />
      </div>
      <button className="btn-primary h-10 w-full" disabled={busy}>{busy ? "מתחבר…" : "התחברות"}</button>
      <p className="pt-1 text-center text-[13px] text-ink-500">
        אין לך חשבון? <Link href="/register" className="font-medium text-brand-600 hover:underline">להרשמה</Link>
      </p>
    </form>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
