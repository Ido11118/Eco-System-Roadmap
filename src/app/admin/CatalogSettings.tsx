"use client";
// ניהול מערכת ← הגדרות: סטטוסים ותיעדופים (שם, צבע, משמעות, סדר, ברירת מחדל, הוספה ומחיקה).
// כל שינוי נשמר מיד ומשפיע על כל התצוגות: גאנט, טבלה, סינון, מקרא וחלונית התכולה.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowUp, ArrowDown, Trash2, Plus, Star, FileCode2 } from "lucide-react";
import { api } from "@/lib/api";
import { STATUS_CATEGORIES, borderFor, contrastText, type CatalogData, type StatusCategory, type StatusDef, type PriorityDef } from "@/lib/catalog";
import { useToast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { CATALOG_KEY } from "@/components/CatalogProvider";

type AdminCatalog = CatalogData & { usage: { statuses: Record<string, number>; priorities: Record<string, number> }; fileSync: boolean };
type Kind = "statuses" | "priorities";

export function CatalogSettings() {
  const q = useQuery({ queryKey: ["admin-catalog"], queryFn: () => api<AdminCatalog>("GET", "/api/admin/catalog") });
  if (!q.data) return <div className="card p-10 text-center text-ink-500">טוען…</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5 text-[12.5px] text-brand-900" data-testid="catalog-sync-note">
        <FileCode2 size={16} className="mt-0.5 shrink-0" />
        {q.data.fileSync ? (
          <span>כל שינוי כאן נשמר גם בקובץ <code className="rounded bg-white/70 px-1" dir="ltr">config/catalog.json</code> בקוד. אחרי דחיפה לגיט ועליית השרת, ההגדרות יוחלו גם בפרודקשן (כולל העברת תכולות מערך שנמחק).</span>
        ) : (
          <span>שינויים כאן חלים מיד בסביבה הזו. ההגדרות מנוהלות גם בקובץ <code className="rounded bg-white/70 px-1" dir="ltr">config/catalog.json</code> בקוד — אם בעדכון הבא הקובץ ישתנה, הערכים שבו יחליפו את הערכים כאן (לפי מפתח).</span>
        )}
      </div>
      <StatusesCard data={q.data} />
      <PrioritiesCard data={q.data} />
    </div>
  );
}

function useMutate() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (method: string, url: string, body?: unknown, ok = "נשמר") => {
    try {
      await api(method, url, body);
      toast.show("success", ok);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-catalog"] }),
        qc.invalidateQueries({ queryKey: CATALOG_KEY }),
        qc.invalidateQueries({ queryKey: ["plan"] }),
      ]);
      return true;
    } catch (e) { toast.show("error", (e as Error).message); return false; }
  };
}

/** תצוגה מקדימה של "קובייה" בצבע הסטטוס */
function Swatch({ bg, label }: { bg: string; label: string }) {
  return (
    <span className="inline-flex h-6 max-w-[150px] items-center truncate rounded-[5px] border px-2 text-[12px] font-medium"
      style={{ background: bg, color: contrastText(bg), borderColor: borderFor(bg) }}>{label || "—"}</span>
  );
}

function StatusesCard({ data }: { data: AdminCatalog }) {
  const mutate = useMutate();
  const [del, setDel] = useState<StatusDef | null>(null);
  const [nw, setNw] = useState({ label: "", bg: "#a78bfa", category: "active" as StatusCategory, noteRecommended: false });
  const list = data.statuses.filter((x) => !x.archived);
  const archived = data.statuses.filter((x) => x.archived);
  const move = (i: number, dir: -1 | 1) => {
    const a = list[i], b = list[i + dir];
    if (!b) return;
    void mutate("PATCH", `/api/admin/statuses/${a.key}`, { sortOrder: b.sortOrder }, "הסדר עודכן")
      .then((ok) => ok && mutate("PATCH", `/api/admin/statuses/${b.key}`, { sortOrder: a.sortOrder }, "הסדר עודכן"));
  };
  return (
    <section className="card overflow-hidden" data-testid="settings-statuses">
      <header className="border-b border-ink-100 px-4 py-3">
        <h2 className="text-[15px] font-semibold">סטטוסים</h2>
        <p className="text-[12px] text-ink-500">הצבע קובע את צבע הקובייה בגאנט, בטבלה, בסינון ובמקרא. &quot;משמעות&quot; קובעת איך הסטטוס נספר בתכנון מול ביצוע (למשל &quot;הושלם&quot;).</p>
      </header>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[12.5px]">
        <thead className="bg-ink-50 text-ink-500">
          <tr>{["", "צבע", "שם", "תצוגה", "משמעות", "המלצה להערה", "ברירת מחדל", "תכולות", ""].map((h, i) => <th key={i} className="px-2 py-1.5 text-start font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {list.map((s, i) => (
            <tr key={s.key} className="border-t border-ink-100" data-status={s.key}>
              <td className="w-[52px] px-2">
                <div className="flex">
                  <button className="icon-btn h-6 w-6" disabled={i === 0} onClick={() => move(i, -1)} aria-label="העלה"><ArrowUp size={13} /></button>
                  <button className="icon-btn h-6 w-6" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="הורד"><ArrowDown size={13} /></button>
                </div>
              </td>
              <td className="px-2"><input type="color" className="h-7 w-9 cursor-pointer rounded border border-ink-200" defaultValue={s.bg} aria-label="צבע"
                onBlur={(e) => { if (e.target.value !== s.bg) void mutate("PATCH", `/api/admin/statuses/${s.key}`, { bg: e.target.value }, "הצבע עודכן"); }} /></td>
              <td className="px-2"><input className="input h-7 w-[170px]" defaultValue={s.label} aria-label="שם הסטטוס" data-testid="status-label"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.label) void mutate("PATCH", `/api/admin/statuses/${s.key}`, { label: v }, "השם עודכן"); else e.target.value = s.label; }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></td>
              <td className="px-2"><Swatch bg={s.bg} label={s.label} /></td>
              <td className="px-2">
                <select className="input h-7 w-auto py-0 text-[12px]" value={s.category} aria-label="משמעות"
                  onChange={(e) => void mutate("PATCH", `/api/admin/statuses/${s.key}`, { category: e.target.value }, "המשמעות עודכנה")}>
                  {STATUS_CATEGORIES.map((c) => <option key={c.key} value={c.key} title={c.hint}>{c.label}</option>)}
                </select>
              </td>
              <td className="px-2 text-center"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={s.noteRecommended} aria-label="המלצה להוסיף הערה"
                onChange={(e) => void mutate("PATCH", `/api/admin/statuses/${s.key}`, { noteRecommended: e.target.checked })} /></td>
              <td className="px-2 text-center">
                <button className={clsx("icon-btn h-6 w-6", s.isDefault && "text-amber-500")} title={s.isDefault ? "סטטוס ברירת המחדל לתכולה חדשה" : "קבע כברירת מחדל"}
                  onClick={() => !s.isDefault && void mutate("PATCH", `/api/admin/statuses/${s.key}`, { isDefault: true }, "ברירת המחדל עודכנה")}>
                  <Star size={14} className={s.isDefault ? "fill-amber-400" : ""} />
                </button>
              </td>
              <td className="px-2 tabular-nums text-ink-500">{data.usage.statuses[s.key] ?? 0}</td>
              <td className="px-2 text-left">
                <button className="icon-btn h-7 w-7 hover:text-red-600" disabled={s.isDefault} title={s.isDefault ? "לא ניתן למחוק את ברירת המחדל" : "מחיקה"}
                  onClick={() => setDel(s)} data-testid={`delete-status-${s.key}`}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <Archived kind="statuses" items={archived.map((x) => ({ key: x.key, label: x.label, swatch: <Swatch bg={x.bg} label={x.label} /> }))} mutate={mutate} />
      <form className="flex flex-wrap items-center gap-2 border-t border-ink-100 bg-ink-50/50 px-4 py-2.5"
        onSubmit={async (e) => { e.preventDefault(); if (!nw.label.trim()) return; if (await mutate("POST", "/api/admin/statuses", { ...nw, label: nw.label.trim() }, "הסטטוס נוסף")) setNw({ ...nw, label: "" }); }}>
        <span className="text-[12px] font-medium text-ink-700">סטטוס חדש:</span>
        <input type="color" className="h-7 w-9 cursor-pointer rounded border border-ink-200" value={nw.bg} onChange={(e) => setNw({ ...nw, bg: e.target.value })} aria-label="צבע" />
        <input className="input h-7 w-[170px]" placeholder="שם הסטטוס" value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} data-testid="new-status-label" />
        <select className="input h-7 w-auto py-0 text-[12px]" value={nw.category} onChange={(e) => setNw({ ...nw, category: e.target.value as StatusCategory })} aria-label="משמעות">
          {STATUS_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[12px] text-ink-500"><input type="checkbox" className="accent-brand-600" checked={nw.noteRecommended} onChange={(e) => setNw({ ...nw, noteRecommended: e.target.checked })} />המלצה להערה</label>
        <Swatch bg={nw.bg} label={nw.label} />
        <button className="btn-primary btn-sm mr-auto" disabled={!nw.label.trim()} data-testid="add-status"><Plus size={13} />הוספה</button>
      </form>
      {del && <DeleteDialog kind="statuses" item={{ key: del.key, label: del.label }} inUse={data.usage.statuses[del.key] ?? 0}
        others={list.filter((x) => x.key !== del.key).map((x) => ({ key: x.key, label: x.label }))} onClose={() => setDel(null)} mutate={mutate} />}
    </section>
  );
}

function PrioritiesCard({ data }: { data: AdminCatalog }) {
  const mutate = useMutate();
  const [del, setDel] = useState<PriorityDef | null>(null);
  const [nw, setNw] = useState({ label: "", color: "#7c3aed" });
  const list = data.priorities.filter((x) => !x.archived);
  const archived = data.priorities.filter((x) => x.archived);
  const move = (i: number, dir: -1 | 1) => {
    const a = list[i], b = list[i + dir];
    if (!b) return;
    void mutate("PATCH", `/api/admin/priorities/${a.key}`, { sortOrder: b.sortOrder }, "הסדר עודכן")
      .then((ok) => ok && mutate("PATCH", `/api/admin/priorities/${b.key}`, { sortOrder: a.sortOrder }, "הסדר עודכן"));
  };
  return (
    <section className="card overflow-hidden" data-testid="settings-priorities">
      <header className="border-b border-ink-100 px-4 py-3">
        <h2 className="text-[15px] font-semibold">תיעדוף</h2>
        <p className="text-[12px] text-ink-500">הסדר קובע את סדר המיון בטבלה (הראשון = החשוב ביותר). ברירת המחדל (למשל &quot;ללא&quot;) ניתנת לתכולה חדשה ומוצגת אחרונה במיון.</p>
      </header>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[12.5px]">
        <thead className="bg-ink-50 text-ink-500">
          <tr>{["", "צבע", "שם", "ברירת מחדל", "תכולות", ""].map((h, i) => <th key={i} className="px-2 py-1.5 text-start font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {list.map((p, i) => (
            <tr key={p.key} className="border-t border-ink-100">
              <td className="w-[52px] px-2">
                <div className="flex">
                  <button className="icon-btn h-6 w-6" disabled={i === 0} onClick={() => move(i, -1)} aria-label="העלה"><ArrowUp size={13} /></button>
                  <button className="icon-btn h-6 w-6" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="הורד"><ArrowDown size={13} /></button>
                </div>
              </td>
              <td className="px-2"><input type="color" className="h-7 w-9 cursor-pointer rounded border border-ink-200" defaultValue={p.color} aria-label="צבע"
                onBlur={(e) => { if (e.target.value !== p.color) void mutate("PATCH", `/api/admin/priorities/${p.key}`, { color: e.target.value }, "הצבע עודכן"); }} /></td>
              <td className="px-2">
                <input className="input h-7 w-[170px] font-semibold" defaultValue={p.label} style={{ color: p.color }} aria-label="שם התיעדוף"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.label) void mutate("PATCH", `/api/admin/priorities/${p.key}`, { label: v }, "השם עודכן"); else e.target.value = p.label; }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
              </td>
              <td className="px-2">
                <button className={clsx("icon-btn h-6 w-6", p.isDefault && "text-amber-500")} title={p.isDefault ? "ברירת המחדל לתכולה חדשה" : "קבע כברירת מחדל"}
                  onClick={() => !p.isDefault && void mutate("PATCH", `/api/admin/priorities/${p.key}`, { isDefault: true }, "ברירת המחדל עודכנה")}>
                  <Star size={14} className={p.isDefault ? "fill-amber-400" : ""} />
                </button>
              </td>
              <td className="px-2 tabular-nums text-ink-500">{data.usage.priorities[p.key] ?? 0}</td>
              <td className="px-2 text-left">
                <button className="icon-btn h-7 w-7 hover:text-red-600" disabled={p.isDefault} title={p.isDefault ? "לא ניתן למחוק את ברירת המחדל" : "מחיקה"} onClick={() => setDel(p)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <Archived kind="priorities" items={archived.map((x) => ({ key: x.key, label: x.label, swatch: <span className="font-semibold" style={{ color: x.color }}>{x.label}</span> }))} mutate={mutate} />
      <form className="flex flex-wrap items-center gap-2 border-t border-ink-100 bg-ink-50/50 px-4 py-2.5"
        onSubmit={async (e) => { e.preventDefault(); if (!nw.label.trim()) return; if (await mutate("POST", "/api/admin/priorities", { ...nw, label: nw.label.trim() }, "התיעדוף נוסף")) setNw({ ...nw, label: "" }); }}>
        <span className="text-[12px] font-medium text-ink-700">תיעדוף חדש:</span>
        <input type="color" className="h-7 w-9 cursor-pointer rounded border border-ink-200" value={nw.color} onChange={(e) => setNw({ ...nw, color: e.target.value })} aria-label="צבע" />
        <input className="input h-7 w-[170px] font-semibold" style={{ color: nw.color }} placeholder="שם התיעדוף" value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} />
        <button className="btn-primary btn-sm mr-auto" disabled={!nw.label.trim()}><Plus size={13} />הוספה</button>
      </form>
      {del && <DeleteDialog kind="priorities" item={{ key: del.key, label: del.label }} inUse={data.usage.priorities[del.key] ?? 0}
        others={list.filter((x) => x.key !== del.key).map((x) => ({ key: x.key, label: x.label }))} onClose={() => setDel(null)} mutate={mutate} />}
    </section>
  );
}

/** ערכים שנמחקו (בארכיון): לא מוצגים לבחירה; תמונות מצב ישנות ממשיכות להציג אותם. ניתן לשחזר. */
function Archived({ kind, items, mutate }: { kind: Kind; items: { key: string; label: string; swatch: React.ReactNode }[]; mutate: ReturnType<typeof useMutate> }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-4 py-2 text-[12px] text-ink-500">
      <span>נמחקו (בארכיון):</span>
      {items.map((x) => (
        <span key={x.key} className="flex items-center gap-1 rounded-md border border-dashed border-ink-200 px-1.5 py-0.5 opacity-80">
          {x.swatch}
          <button className="text-brand-600 hover:underline" onClick={() => void mutate("PATCH", `/api/admin/${kind}/${x.key}`, { archived: false }, "שוחזר")}>שחזור</button>
        </span>
      ))}
    </div>
  );
}

/** מחיקה: אם יש תכולות בערך הזה — בוחרים ערך חלופי שאליו יועברו (כולן מקבלות גרסה חדשה ונרשמות ביומן) */
function DeleteDialog({ kind, item, inUse, others, onClose, mutate }: {
  kind: Kind; item: { key: string; label: string }; inUse: number; others: { key: string; label: string }[];
  onClose: () => void; mutate: ReturnType<typeof useMutate>;
}) {
  const [rep, setRep] = useState(others[0]?.key ?? "");
  const noun = kind === "statuses" ? "סטטוס" : "תיעדוף";
  return (
    <Dialog open onClose={onClose} title={`מחיקת ${noun} "${item.label}"`} width={440}
      footer={<>
        <button className="btn-danger" data-testid="confirm-delete-catalog" onClick={async () => {
          if (await mutate("DELETE", `/api/admin/${kind}/${item.key}${inUse ? `?replaceWith=${encodeURIComponent(rep)}` : ""}`, undefined, `ה${noun} נמחק`)) onClose();
        }}>מחיקה</button>
        <button className="btn-secondary" onClick={onClose}>ביטול</button>
      </>}>
      {inUse > 0 ? (
        <div className="space-y-2 text-[13px]">
          <p>ב{noun} זה יש <b>{inUse}</b> תכולות. לאן להעביר אותן?</p>
          <select className="input" value={rep} onChange={(e) => setRep(e.target.value)} data-testid="replace-with">
            {others.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <p className="text-[12px] text-ink-500">ההעברה נרשמת ביומן הפעולות. תמונות מצב ישנות לא משתנות וממשיכות להציג את ה{noun} המקורי. ניתן לשחזר אותו בהמשך.</p>
        </div>
      ) : <p className="text-[13px]">אין תכולות ב{noun} זה. למחוק? (ניתן לשחזר בהמשך)</p>}
    </Dialog>
  );
}
