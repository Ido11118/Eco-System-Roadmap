"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Users, User as UserIcon, Eye, GitCompareArrows, Pencil, Trash2, History, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import type { Me, SnapshotMeta } from "@/lib/types";
import { api } from "@/lib/api";
import { TopBar } from "@/components/TopBar";
import { AppShell } from "@/components/AppShell";
import { useToast } from "@/components/ui/toast";
import { useConfirm, Dialog } from "@/components/ui/dialog";
import { fmtTs } from "@/components/plan/ui";
import { fmtDate } from "@/lib/weeks";

type Rev = { id: number; revisionNo: number; note: string; createdAt: string; createdBy: string | null; items: number };

export function SnapshotsApp({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ["snapshots"], queryFn: () => api<SnapshotMeta[]>("GET", "/api/snapshots") });
  const shared = (q.data ?? []).filter((s) => s.scope === "shared");
  const mine = (q.data ?? []).filter((s) => s.scope === "personal");
  return (
    <AppShell me={me} active="snapshots">
      <TopBar me={me}><span className="text-[14px] font-semibold text-ink-900">תמונות מצב</span></TopBar>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1000px] px-3 py-4 md:px-6 md:py-6">
          <h1 className="text-[20px] font-bold">תמונות מצב (Snapshots)</h1>
          <p className="mt-1 text-ink-500">
            עותקים היסטוריים של תוכנית העבודה. ניתן לצפות בכל תמונת מצב או להשתמש בה להשוואת תכנון מול ביצוע.
            עריכת תוכן יוצרת גרסה (Revision) חדשה — הגרסאות הקודמות נשמרות וניתנות לשחזור.
          </p>
          {q.isLoading && <div className="mt-5 text-ink-500">טוען…</div>}
          {q.data && (
            <>
              <section className="mt-6" data-testid="shared-snapshots">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-900"><Users size={16} className="text-brand-600" />תמונות מצב משותפות</h2>
                <p className="mb-3 text-[12px] text-ink-400">גלויות לכל המשתמשים. נוצרות ומנוהלות ע״י מנהל המערכת.</p>
                <div className="space-y-3">
                  {shared.length === 0 && <div className="card p-6 text-center text-ink-500">אין עדיין תמונות מצב משותפות.</div>}
                  {shared.map((s) => <SnapshotCard key={s.id} s={s} />)}
                </div>
              </section>
              <section className="mt-8" data-testid="my-snapshots">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-900"><UserIcon size={16} className="text-violet-600" />תמונות המצב שלי</h2>
                <p className="mb-3 text-[12px] text-ink-400">תמונות מצב אלו לא משותפות עם שאר המשתמשים</p>
                <div className="space-y-3">
                  {mine.length === 0 && (
                    <div className="card p-6 text-center text-ink-500">
                      <Camera className="mx-auto mb-2 text-ink-300" />
                      עדיין לא שמרת תמונות מצב אישיות.
                    </div>
                  )}
                  {mine.map((s) => <SnapshotCard key={s.id} s={s} />)}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function SnapshotCard({ s }: { s: SnapshotMeta }) {
  const canManage = s.canManage; // משותפת: מנהל המערכת; אישית: הבעלים
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: s.name, description: s.description, asOfDate: s.asOfDate });
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const revs = useQuery({ queryKey: ["revisions", s.id], queryFn: () => api<Rev[]>("GET", `/api/snapshots/${s.id}/revisions`), enabled: open });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["snapshots"] }); qc.invalidateQueries({ queryKey: ["revisions", s.id] }); qc.invalidateQueries({ queryKey: ["snapshot", s.id] }); };
  return (
    <div className="card p-4" data-testid={`snapshot-${s.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Camera size={15} className="text-ink-400" />
            <span className="text-[14px] font-semibold">{s.name}</span>
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700" title="תאריך המצב — קובע את הסדר בהשוואת תכנון מול ביצוע">{fmtDate(s.asOfDate)}</span>
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-500">גרסה {s.currentRevisionNo}{s.revisionCount > 1 ? ` מתוך ${s.revisionCount}` : ""}</span>
          </div>
          {s.description && <p className="mt-1 text-[12.5px] text-ink-700">{s.description}</p>}
          <div className="mt-1 text-[11.5px] text-ink-400">נוצר ע״י {s.createdBy} · {fmtTs(s.createdAt)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link className="btn-secondary btn-sm" href={`/plan?snap=${s.id}`}><Eye size={13} />צפייה</Link>
          <Link className="btn-secondary btn-sm" href={`/plan?view=compare&a=${s.id}&b=live`}><GitCompareArrows size={13} />השוואה למצב הנוכחי</Link>
          {canManage && <Link className="btn-secondary btn-sm" href={`/snapshots/${s.id}/edit`} data-testid="edit-snapshot"><Pencil size={13} />עריכת תוכן</Link>}
          {canManage && <button className="icon-btn" title="שינוי שם, תאריך ותיאור" onClick={() => { setF({ name: s.name, description: s.description, asOfDate: s.asOfDate }); setEdit(true); }}><Pencil size={13} /></button>}
          {canManage && <button className="icon-btn hover:text-red-600" title="מחיקה" onClick={async () => {
            if (await confirm({ title: "מחיקת Snapshot", text: `למחוק את "${s.name}"? לא ניתן יהיה להשתמש בו להשוואה.`, confirm: "מחיקה", danger: true })) {
              try { await api("DELETE", `/api/snapshots/${s.id}`); refresh(); toast.show("success", "נמחק"); } catch (e) { toast.show("error", (e as Error).message); }
            }
          }}><Trash2 size={13} /></button>}
          <button className="btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} data-testid="toggle-revisions"><History size={13} />גרסאות {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
        </div>
      </div>
      {open && (
        <div className="mt-3 overflow-hidden rounded-lg border border-ink-200">
          <table className="w-full text-[12.5px]">
            <thead className="bg-ink-50 text-ink-500"><tr>{["גרסה", "הערה", "נוצרה", "תכולות", ""].map((h, i) => <th key={i} className="px-3 py-1.5 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {revs.data?.map((r) => (
                <tr key={r.id} className="border-t border-ink-100">
                  <td className="px-3 py-1.5 font-medium">{r.revisionNo}{r.id === s.currentRevisionId && <span className="mr-1.5 rounded bg-green-100 px-1.5 text-[10.5px] text-green-800">נוכחית</span>}</td>
                  <td className="px-3">{r.note}</td>
                  <td className="px-3 text-ink-500">{fmtTs(r.createdAt)} · {r.createdBy}</td>
                  <td className="px-3 tabular-nums">{r.items}</td>
                  <td className="px-3 text-left">
                    <Link className="btn-ghost btn-sm" href={`/plan?snap=${s.id}&rev=${r.id}`}>צפייה</Link>
                    <Link className="btn-ghost btn-sm" href={`/plan?view=compare&a=${s.id}:${r.id}&b=live`}>השוואה</Link>
                    {canManage && r.id !== s.currentRevisionId && (
                      <button className="btn-ghost btn-sm" data-testid={`restore-${r.revisionNo}`} onClick={async () => {
                        if (await confirm({ title: "שחזור גרסה", text: `לשחזר את גרסה ${r.revisionNo}? תיווצר גרסה חדשה עם תוכן זה; ההיסטוריה נשמרת.`, confirm: "שחזור" })) {
                          try { await api("POST", `/api/snapshots/${s.id}/restore`, { revisionId: r.id }); refresh(); toast.show("success", "הגרסה שוחזרה"); } catch (e) { toast.show("error", (e as Error).message); }
                        }
                      }}><RotateCcw size={12} />שחזור</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={edit} onClose={() => setEdit(false)} title="פרטי Snapshot"
        footer={<><button className="btn-primary" onClick={async () => {
          try { await api("PATCH", `/api/snapshots/${s.id}`, f); refresh(); setEdit(false); toast.show("success", "נשמר"); } catch (e) { toast.show("error", (e as Error).message); }
        }}>שמירה</button><button className="btn-secondary" onClick={() => setEdit(false)}>ביטול</button></>}>
        <div className="space-y-3">
          <div><label className="label">שם</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div>
            <label className="label">תאריך המצב</label>
            <input type="date" className="input" value={f.asOfDate} onChange={(e) => setF({ ...f, asOfDate: e.target.value })} data-testid="snapshot-date-edit" />
            <p className="mt-1 text-[11.5px] text-ink-400">בהשוואת תכנון מול ביצוע, המצב בעל התאריך המוקדם יותר משמש כתכנון.</p>
          </div>
          <div><label className="label">תיאור</label><textarea className="input min-h-[70px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        </div>
      </Dialog>
    </div>
  );
}
