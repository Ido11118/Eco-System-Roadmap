"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, X, PauseCircle, PlayCircle, KeyRound, Copy, Eye, Save } from "lucide-react";
import type { Me } from "@/lib/types";
import { api } from "@/lib/api";
import { TopBar } from "@/components/TopBar";
import { AppShell } from "@/components/AppShell";
import { useToast } from "@/components/ui/toast";
import { useConfirm, Dialog } from "@/components/ui/dialog";
import { fmtTs } from "@/components/plan/ui";

type AdminUser = {
  id: number; email: string; fullName: string; role: "SUPER" | "USER"; status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  canEditCross: boolean; createdAt: string; approvedAt: string | null; domainIds: number[];
  request: { domainIds: number[]; cross: boolean; createdAt: string } | null;
};
const STATUS_LABEL = { PENDING: "ממתין לאישור", APPROVED: "מאושר", REJECTED: "נדחה", SUSPENDED: "מושעה" };
const STATUS_CLS = { PENDING: "bg-amber-100 text-amber-800", APPROVED: "bg-green-100 text-green-800", REJECTED: "bg-red-100 text-red-700", SUSPENDED: "bg-ink-200 text-ink-700" };

export function AdminApp({ me, domains }: { me: Me; domains: { id: number; name: string }[] }) {
  const [tab, setTab] = useState<"pending" | "users" | "audit">("pending");
  const q = useQuery({ queryKey: ["admin-users"], queryFn: () => api<AdminUser[]>("GET", "/api/admin/users"), refetchInterval: 15000 });
  const users = q.data ?? [];
  const pending = users.filter((u) => u.status === "PENDING");
  return (
    <AppShell me={me} active="admin">
      <TopBar me={me}><span className="text-[14px] font-semibold text-ink-900">ניהול מערכת</span></TopBar>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1200px] px-6 py-6">
          <h1 className="text-[20px] font-bold">ניהול משתמשים והרשאות</h1>
          <p className="mt-1 text-ink-500">אישור משתמש מקנה צפייה בכל תוכנית העבודה. הרשאות עריכה ניתנות לפי תחום, ובנפרד למידע הרוחבי.</p>
          <div className="mt-5 flex gap-1 border-b border-ink-200">
            {([["pending", `בקשות ממתינות (${pending.length})`], ["users", `כל המשתמשים (${users.length})`], ["audit", "יומן פעולות"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} data-testid={`admin-tab-${k}`}
                className={clsx("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium", tab === k ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-900")}>{l}</button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {tab === "audit" ? <AuditLog /> : (
              (tab === "pending" ? pending : users).length === 0
                ? <div className="card p-10 text-center text-ink-500">{tab === "pending" ? "אין בקשות ממתינות." : "אין משתמשים."}</div>
                : (tab === "pending" ? pending : users).map((u) => <UserCard key={u.id} u={u} domains={domains} />)
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function UserCard({ u, domains }: { u: AdminUser; domains: { id: number; name: string }[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const initialDomains = u.status === "PENDING" ? (u.request?.domainIds ?? []) : u.domainIds;
  const [sel, setSel] = useState<number[]>(initialDomains);
  const [cross, setCross] = useState(u.status === "PENDING" ? !!u.request?.cross : u.canEditCross);
  const [link, setLink] = useState<string | null>(null);
  // סנכרון מחדש מהשרת (למשל אחרי שינוי שבוצע בלשונית אחרת) — כדי לא לדרוס בשקט מצב עדכני
  const serverKey = `${u.status}|${u.canEditCross}|${[...u.domainIds].sort().join(",")}`;
  useEffect(() => {
    setSel(u.status === "PENDING" ? (u.request?.domainIds ?? []) : u.domainIds);
    setCross(u.status === "PENDING" ? !!u.request?.cross : u.canEditCross);
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = u.status !== "PENDING" && (cross !== u.canEditCross || sel.length !== u.domainIds.length || sel.some((d) => !u.domainIds.includes(d)));
  const act = async (body: Record<string, unknown>, msg: string) => {
    try {
      const r = await api<{ link?: string }>("POST", `/api/admin/users/${u.id}`, body);
      if (r.link) setLink(r.link); else toast.show("success", msg);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["pending-count"] });
    } catch (e) { toast.show("error", (e as Error).message); }
  };
  const name = (id: number) => domains.find((d) => d.id === id)?.name ?? `#${id}`;
  const isSuper = u.role === "SUPER";
  return (
    <div className="card p-4" data-testid={`user-card-${u.email}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">{u.fullName}</span>
            <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_CLS[u.status])}>{STATUS_LABEL[u.status]}</span>
            {isSuper && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700">מנהל מערכת</span>}
          </div>
          <div className="text-[12.5px] text-ink-500" dir="ltr" style={{ textAlign: "right" }}>{u.email}</div>
          <div className="mt-1 text-[11.5px] text-ink-400">נרשם {fmtTs(u.createdAt)}{u.approvedAt ? ` · אושר ${fmtTs(u.approvedAt)}` : ""}</div>
          {u.request && (
            <div className="mt-2 text-[12px] text-ink-500">
              ביקש: {u.request.domainIds.length ? u.request.domainIds.map(name).join(", ") : "ללא תחומים"}{u.request.cross ? " + רוחבי" : ""}
            </div>
          )}
        </div>
        {!isSuper && (
          <div className="flex-[2]">
            <div className="label">הרשאות עריכה בפועל</div>
            <div className="flex flex-wrap gap-1.5">
              {domains.map((d) => (
                <button key={d.id} type="button" onClick={() => setSel((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]))}
                  className={clsx("chip h-7 cursor-pointer", sel.includes(d.id) && "border-brand-500 bg-brand-50 text-brand-700", u.request?.domainIds.includes(d.id) && !sel.includes(d.id) && "border-dashed border-amber-400")}>
                  {sel.includes(d.id) && <Check size={12} />}{d.name}
                </button>
              ))}
              <button type="button" onClick={() => setCross((c) => !c)}
                className={clsx("chip h-7 cursor-pointer", cross && "border-violet-500 bg-violet-50 text-violet-700")}>
                {cross && <Check size={12} />}רוחבי
              </button>
            </div>
            <div className="mt-1.5 flex gap-2 text-[11.5px]">
              <button className="text-brand-600 hover:underline" onClick={() => { setSel(domains.map((d) => d.id)); setCross(true); }}>הכל</button>
              <button className="text-brand-600 hover:underline" onClick={() => { setSel([]); setCross(false); }}>ללא (צפייה בלבד)</button>
            </div>
          </div>
        )}
      </div>
      {!isSuper && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
          {u.status === "PENDING" && <>
            <button className="btn-primary btn-sm" onClick={() => act({ action: "approve", domainIds: sel, canEditCross: cross }, "המשתמש אושר")} data-testid="approve"><Check size={13} />אישור עם ההרשאות שנבחרו</button>
            <button className="btn-secondary btn-sm" onClick={() => act({ action: "approve", domainIds: [], canEditCross: false }, "המשתמש אושר לצפייה בלבד")}><Eye size={13} />אישור לצפייה בלבד</button>
            <button className="btn-ghost btn-sm text-red-600 hover:bg-red-50" onClick={async () => { if (await confirm({ title: "דחיית משתמש", text: `לדחות את בקשת ההרשמה של ${u.fullName}?`, confirm: "דחייה", danger: true })) await act({ action: "reject" }, "הבקשה נדחתה"); }}><X size={13} />דחייה</button>
          </>}
          {u.status === "APPROVED" && <>
            <button className="btn-primary btn-sm" disabled={!dirty} onClick={() => act({ action: "setPermissions", domainIds: sel, canEditCross: cross }, "ההרשאות עודכנו")} data-testid="save-perms"><Save size={13} />שמירת הרשאות</button>
            <button className="btn-ghost btn-sm" onClick={async () => { if (await confirm({ title: "השעיית משתמש", text: `להשעות את הגישה של ${u.fullName}? המשתמש ינותק מיד.`, confirm: "השעיה", danger: true })) await act({ action: "suspend" }, "המשתמש הושעה"); }}><PauseCircle size={13} />השעיה</button>
          </>}
          {(u.status === "SUSPENDED" || u.status === "REJECTED") && (
            <button className="btn-secondary btn-sm" onClick={() => act({ action: u.status === "REJECTED" ? "approve" : "reactivate", domainIds: sel, canEditCross: cross }, "הגישה הופעלה")}><PlayCircle size={13} />{u.status === "REJECTED" ? "אישור" : "הפעלה מחדש"}</button>
          )}
          <button className="btn-ghost btn-sm mr-auto" onClick={() => act({ action: "resetLink" }, "")}><KeyRound size={13} />קישור לאיפוס סיסמה</button>
        </div>
      )}
      <Dialog open={!!link} onClose={() => setLink(null)} title="קישור לאיפוס סיסמה" footer={<button className="btn-secondary" onClick={() => setLink(null)}>סגירה</button>}>
        <p className="mb-2 text-[12.5px] text-ink-500">העבר את הקישור למשתמש בערוץ מאובטח. הקישור בתוקף לשעה ולשימוש חד-פעמי.</p>
        <div className="flex gap-1">
          <input className="input font-mono text-[11px]" dir="ltr" readOnly value={link ?? ""} onFocus={(e) => e.target.select()} />
          <button className="btn-secondary" onClick={() => { void navigator.clipboard?.writeText(link ?? ""); toast.show("success", "הועתק"); }}><Copy size={13} /></button>
        </div>
      </Dialog>
    </div>
  );
}

function AuditLog() {
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api<{ id: number; at: string; entityType: string; entityId: string; action: string; summary: string; userName: string | null }[]>("GET", "/api/admin/audit?limit=500") });
  const ET: Record<string, string> = { item: "תכולה", row: "שורה", milestone: "אבן דרך", sprint: "ספרינט", snapshot: "Snapshot", user: "משתמש" };
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead className="bg-ink-50 text-ink-500"><tr>{["זמן", "משתמש", "ישות", "פעולה"].map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {(q.data ?? []).map((r) => (
            <tr key={r.id} className="border-t border-ink-100">
              <td className="whitespace-nowrap px-3 py-1.5 text-ink-500">{fmtTs(r.at)}</td>
              <td className="px-3">{r.userName ?? "—"}</td>
              <td className="px-3 text-ink-500">{ET[r.entityType] ?? r.entityType} #{r.entityId}</td>
              <td className="px-3">{r.summary || r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.isLoading && <div className="p-6 text-center text-ink-500">טוען…</div>}
    </div>
  );
}
