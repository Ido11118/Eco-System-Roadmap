"use client";
// "הגדרות" של המשתמש (מתפריט השם למעלה): ההרשאות שלי + בקשת הרשאות עריכה נוספות, ושינוי סיסמה.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Clock, KeyRound, ShieldCheck, Eye } from "lucide-react";
import type { Me } from "@/lib/types";
import { api } from "@/lib/api";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { PasswordInput } from "@/components/ui/PasswordInput";

type Settings = {
  domains: { id: number; name: string }[];
  requests: { id: number; kind: string; domainIds: number[]; requestCross: boolean; createdAt: string }[];
};

export function UserSettingsDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [tab, setTab] = useState<"perms" | "password">("perms");
  return (
    <Dialog open onClose={onClose} width={560} title={<span className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand-600" />הגדרות</span>}
      footer={<button className="btn-secondary" onClick={onClose}>סגירה</button>}>
      <div className="mb-3 flex gap-1 border-b border-ink-200">
        {([["perms", "ההרשאות שלי"], ["password", "שינוי סיסמה"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`settings-tab-${k}`}
            className={clsx("-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium", tab === k ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-900")}>{l}</button>
        ))}
      </div>
      {tab === "perms" ? <Permissions me={me} /> : <ChangePassword />}
    </Dialog>
  );
}

function Permissions({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["my-settings"], queryFn: () => api<Settings>("GET", "/api/me/requests") });
  const [sel, setSel] = useState<number[]>([]);
  const [cross, setCross] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!q.data) return <div className="py-6 text-center text-ink-400">טוען…</div>;
  const isSuper = me.role === "SUPER";
  const open = q.data.requests.find((r) => r.kind === "permissions");
  const has = (id: number) => isSuper || me.domainIds.includes(id);
  const pending = (id: number) => !!open?.domainIds.includes(id);
  const name = (id: number) => q.data!.domains.find((d) => d.id === id)?.name ?? `#${id}`;
  const send = async () => {
    setBusy(true);
    try {
      await api("POST", "/api/me/requests", { domainIds: sel, requestCross: cross, note });
      toast.show("success", "הבקשה נשלחה למנהל המערכת");
      setSel([]); setCross(false); setNote("");
      await qc.invalidateQueries({ queryKey: ["my-settings"] });
    } catch (e) { toast.show("error", (e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-3 text-[13px]" data-testid="settings-perms">
      <p className="flex items-start gap-2 text-ink-500"><Eye size={15} className="mt-0.5 shrink-0" />צפייה בכל תוכנית העבודה פתוחה לך תמיד. כאן רואים באילו תחומים יש לך גם הרשאת <b>עריכה</b>, ואפשר לבקש עוד.</p>
      <div className="grid grid-cols-2 gap-1.5">
        {q.data.domains.map((d) => (
          <label key={d.id} data-domain-perm={d.id}
            className={clsx("flex items-center gap-2 rounded-md border px-2.5 py-1.5", has(d.id) ? "border-green-200 bg-green-50" : "border-ink-200")}>
            {has(d.id) ? <Check size={14} className="text-green-700" />
              : pending(d.id) ? <Clock size={14} className="text-amber-600" />
              : !isSuper && <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={sel.includes(d.id)}
                  onChange={(e) => setSel((s) => (e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id)))} aria-label={`בקשת עריכה ל${d.name}`} />}
            <span className="flex-1">{d.name}</span>
            <span className={clsx("text-[11px]", has(d.id) ? "text-green-700" : pending(d.id) ? "text-amber-700" : "text-ink-400")}>
              {has(d.id) ? "עריכה" : pending(d.id) ? "ממתין לאישור" : "צפייה"}
            </span>
          </label>
        ))}
        <label className={clsx("col-span-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5", (isSuper || me.canEditCross) ? "border-green-200 bg-green-50" : "border-ink-200")}>
          {isSuper || me.canEditCross ? <Check size={14} className="text-green-700" />
            : open?.requestCross ? <Clock size={14} className="text-amber-600" />
            : <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={cross} onChange={(e) => setCross(e.target.checked)} aria-label="בקשת עריכה רוחבית" />}
          <span className="flex-1">מידע רוחבי (גורמים משפיעים, מופעים ואבני דרך רוחביות)</span>
          <span className="text-[11px] text-ink-500">{isSuper || me.canEditCross ? "עריכה" : open?.requestCross ? "ממתין לאישור" : "צפייה"}</span>
        </label>
      </div>
      {open && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900" data-testid="open-request">
          יש לך בקשה ממתינה לאישור מנהל המערכת: {[...open.domainIds.map(name), ...(open.requestCross ? ["רוחבי"] : [])].join(", ")}.
          בקשה נוספת תעדכן אותה.
        </p>
      )}
      {!isSuper && (
        <>
          <textarea className="input min-h-[54px]" placeholder="הערה למנהל המערכת (לא חובה) — למשל: הצטרפתי לצוות עזרים 2" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary" disabled={busy || (!sel.length && !cross)} onClick={() => void send()} data-testid="request-perms">
            בקשת הרשאות עריכה {sel.length + (cross ? 1 : 0) ? `(${sel.length + (cross ? 1 : 0)})` : ""}
          </button>
        </>
      )}
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [f, setF] = useState({ current: "", next: "", next2: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.next !== f.next2) { toast.show("error", "הסיסמאות החדשות אינן תואמות"); return; }
    setBusy(true);
    try {
      await api("POST", "/api/me/password", { current: f.current, next: f.next });
      toast.show("success", "הסיסמה עודכנה. מכשירים אחרים שהיו מחוברים נותקו.");
      setF({ current: "", next: "", next2: "" });
    } catch (er) { toast.show("error", (er as Error).message); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="settings-password">
      <div><label className="label" htmlFor="pw-current">סיסמה נוכחית</label>
        <PasswordInput id="pw-current" value={f.current} onChange={(v) => setF({ ...f, current: v })} show={show} onToggle={() => setShow((x) => !x)} autoComplete="current-password" minLength={1} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="pw-next">סיסמה חדשה</label>
          <PasswordInput id="pw-next" value={f.next} onChange={(v) => setF({ ...f, next: v })} show={show} onToggle={() => setShow((x) => !x)} />
          <p className="mt-1 text-[11px] text-ink-400">8 תווים לפחות</p></div>
        <div><label className="label" htmlFor="pw-next2">אימות סיסמה חדשה</label>
          <PasswordInput id="pw-next2" value={f.next2} onChange={(v) => setF({ ...f, next2: v })} show={show} onToggle={() => setShow((x) => !x)}
            status={!f.next2 ? undefined : f.next2 === f.next ? "match" : "mismatch"} /></div>
      </div>
      <button className="btn-primary" disabled={busy} data-testid="change-password"><KeyRound size={14} />{busy ? "מעדכן…" : "עדכון סיסמה"}</button>
    </form>
  );
}
