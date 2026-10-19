"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { X, Trash2, History, Info, AlertTriangle, Lock, Diamond, Flag, GanttChartSquare } from "lucide-react";
import { api } from "@/lib/api";
import type { BacklogDTO, ItemDTO, Me, MilestoneDTO, PlanData, SprintDTO } from "@/lib/types";
import {
  CROSS_ROW_LABELS, DELETED_RETENTION_DAYS,
} from "@/lib/constants";
import { currentWeekIL, fmtDate, isISODate, todayIL, weekLabel, addDays, type ISODate } from "@/lib/weeks";
import { Dialog, useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { msCanEdit, msScopeValue, parseMsScope } from "@/lib/milestone";
import { WeekPicker } from "./WeekPicker";
import { useCatalog } from "@/components/CatalogProvider";
import type { PlanStore } from "./store";
import { DependenciesEditor } from "./Dependencies";

type NewItemPrefill = {
  teamId?: number | null; rowId?: number; startWeek?: ISODate; endWeek?: ISODate; name?: string; status?: string; priority?: string; notes?: string;
  /** "העברה לגאנט" של פריט מהבאקלוג (onGantt: נפתח מתוך בחירת טווח על הגאנט) */
  backlog?: { id: number; version: number; onGantt?: boolean };
};
type MsPrefill = { teamId?: number | null; domainId?: number | null; date?: ISODate };
type SprintPrefill = { domainId?: number; startDate?: ISODate; endDate?: ISODate; name?: string };

type UI = {
  me: Me;
  openItem: (id: number) => void;
  selectedItemId: number | null;
  openNewItem: (p?: NewItemPrefill) => void;
  openMilestone: (m: MilestoneDTO | null, prefill?: MsPrefill) => void;
  openSprint: (s: SprintDTO | null, prefill?: SprintPrefill) => void;
  /** משבצים כרגע פריט מהבאקלוג על הגאנט */
  placing: BacklogDTO | null;
};
const UICtx = createContext<UI | null>(null);
/** המשתמש המחובר (בתוך מסכי העבודה) */
export function useMe(): Me | null {
  return useContext(UICtx)?.me ?? null;
}
export function useWorkspaceUI() {
  const c = useContext(UICtx);
  if (!c) throw new Error("WorkspaceUI missing");
  return c;
}

export function userName(data: PlanData | undefined, id: number | null) {
  if (!id) return "—";
  return data?.users.find((u) => u.id === id)?.fullName ?? `#${id}`;
}

export function fmtTs(s: string) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function placeLabel(data: PlanData | undefined, item: Pick<ItemDTO, "rowId" | "teamId">) {
  const row = data?.rows.find((r) => r.id === item.rowId);
  if (row && row.kind !== "TEAM") return { domain: "רוחבי", team: CROSS_ROW_LABELS[row.kind] };
  const team = data?.teams.find((t) => t.id === item.teamId);
  const dom = data?.domains.find((d) => d.id === team?.domainId);
  return { domain: dom?.name ?? "—", team: team?.name ?? "—" };
}

export function StatusPill({ status, small }: { status: string; small?: boolean }) {
  const m = useCatalog().status(status);
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full border font-medium", small ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-[12px]")}
      style={{ background: m.bg, color: m.fg, borderColor: m.border }}>
      {m.label}
    </span>
  );
}

export function StatusSelect({ value, onChange, disabled, id }: { value: string; onChange: (s: string) => void; disabled?: boolean; id?: string }) {
  const cat = useCatalog();
  const m = cat.status(value);
  return (
    <select id={id} className="input font-medium" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ background: m.bg, color: m.fg, borderColor: m.border }}>
      {cat.statuses.map((s) => <option key={s.key} value={s.key} style={{ background: "#fff", color: "#0f172a" }}>{s.label}</option>)}
      {!cat.statuses.some((s) => s.key === value) && <option value={value}>{m.label}</option>}
    </select>
  );
}

export function PrioritySelect({ value, onChange, disabled, id }: { value: string; onChange: (p: string) => void; disabled?: boolean; id?: string }) {
  const cat = useCatalog();
  const none = value === cat.defaultPriority;
  return (
    <select id={id} className="input" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ color: none ? undefined : cat.priority(value).color, fontWeight: none ? 400 : 600 }}>
      {cat.priorities.map((p) => <option key={p.key} value={p.key} style={{ color: "#0f172a", fontWeight: 400 }}>{p.label}</option>)}
      {!cat.priorities.some((p) => p.key === value) && <option value={value}>{cat.priority(value).label}</option>}
    </select>
  );
}

/** רשימת יעדים לפי הרשאות: צוותים (מקובצים לפי תחום) ושורות רוחביות */
function TargetSelect({ data, store, value, onChange }: {
  data: PlanData; store: PlanStore; value: string; onChange: (v: string) => void;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} data-testid="target-select">
      <option value="" disabled>בחר צוות…</option>
      {store.canEditCross() && (
        <optgroup label="רוחבי">
          {data.rows.filter((r) => r.kind !== "TEAM").map((r) => <option key={r.id} value={`cross:${r.id}`}>{CROSS_ROW_LABELS[r.kind as "INFLUENCE"]}</option>)}
        </optgroup>
      )}
      {data.domains.map((d) => {
        const teams = data.teams.filter((t) => t.domainId === d.id && store.canEditTeam(t.id));
        if (!teams.length) return null;
        return (
          <optgroup key={d.id} label={d.name}>
            {teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{d.isSingleTeam ? d.name : `${d.name} / ${t.name}`}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}

export function WorkspaceUIProvider({ store, me, children, placing, onScheduled }: {
  store: PlanStore; me: Me; children: React.ReactNode;
  /** פריט מהבאקלוג שמשבצים כרגע על הגאנט: כל "הוספת תכולה" (מסימון טווח) תמלא את פרטיו */
  placing?: BacklogDTO | null;
  onScheduled?: (it: ItemDTO, onGantt: boolean) => void;
}) {
  const [itemId, setItemId] = useState<number | null>(null);
  const [newItem, setNewItem] = useState<NewItemPrefill | null>(null);
  const [ms, setMs] = useState<{ m: MilestoneDTO | null; prefill?: MsPrefill } | null>(null);
  const [sp, setSp] = useState<{ s: SprintDTO | null; prefill?: SprintPrefill } | null>(null);
  const ui = useMemo<UI>(() => ({
    me,
    openItem: (id) => setItemId(id),
    selectedItemId: itemId,
    openNewItem: (p) => setNewItem(placing && !p?.backlog
      ? { ...p, teamId: p?.teamId ?? placing.teamId, name: placing.name, priority: placing.priority, notes: placing.notes, backlog: { id: placing.id, version: placing.version, onGantt: true } }
      : p ?? {}),
    openMilestone: (m, prefill) => setMs({ m, prefill }),
    openSprint: (s, prefill) => setSp({ s, prefill }),
    placing: placing ?? null,
  }), [itemId, me, placing]);
  return (
    <UICtx.Provider value={ui}>
      {children}
      {itemId !== null && <ItemPanel key={itemId} store={store} id={itemId} onClose={() => setItemId(null)} />}
      {newItem && <NewItemDialog store={store} prefill={newItem} onClose={() => setNewItem(null)}
        onCreated={(it) => { setNewItem(null); if (it) setItemId(it.id); }}
        onScheduled={(it) => { setNewItem(null); onScheduled?.(it, !!newItem.backlog?.onGantt); }} />}
      {ms && <MilestoneDialog store={store} m={ms.m} prefill={ms.prefill} onClose={() => setMs(null)} />}
      {sp && <SprintDialog store={store} s={sp.s} prefill={sp.prefill} onClose={() => setSp(null)} />}
      <span hidden data-me={me.id} />
    </UICtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// חלונית פרטי תכולה
// ---------------------------------------------------------------------------
function ItemPanel({ store, id, onClose }: { store: PlanStore; id: number; onClose: () => void }) {
  const data = store.data;
  const item = data?.items.find((i) => i.id === id);
  const confirm = useConfirm();
  const cat = useCatalog();
  const [tab, setTab] = useState<"details" | "history">("details");
  const [name, setName] = useState(item?.name ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  // מסנכרנים מהשרת רק כשהמשתמש לא באמצע עריכה של השדה
  const dirtyName = useRef(false), dirtyNotes = useRef(false);
  useEffect(() => { if (!dirtyName.current) setName(item?.name ?? ""); }, [item?.name]);
  useEffect(() => { if (!dirtyNotes.current) setNotes(item?.notes ?? ""); }, [item?.notes]);
  // שמירת עריכות שלא נשמרו כשהחלונית נסגרת או עוברת לתכולה אחרת (Escape, קליק על קובייה אחרת)
  const latest = useRef({ name, notes, item, store });
  latest.current = { name, notes, item, store };
  useEffect(() => () => {
    const { name: n, notes: t, item: it, store: st } = latest.current;
    if (!it || !st.canEditRow(st.data?.rows.find((r) => r.id === it.rowId))) return;
    const patch: { name?: string; notes?: string } = {};
    if (dirtyName.current && n.trim() && n.trim() !== it.name) patch.name = n.trim();
    if (dirtyNotes.current && t !== it.notes) patch.notes = t;
    if (Object.keys(patch).length) void st.updateItem(it, patch, { silent: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog]")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!data) return null;
  if (!item) {
    return (
      <aside className="anim-drawer fixed bottom-0 left-0 top-0 z-[70] w-[400px] border-r border-ink-200 bg-white p-5 shadow-pop">
        <div className="flex items-center justify-between"><span className="text-ink-500">התכולה אינה קיימת (ייתכן שנמחקה).</span><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
      </aside>
    );
  }
  const row = data.rows.find((r) => r.id === item.rowId);
  const editable = store.canEditRow(row);
  const place = placeLabel(data, item);
  const save = (patch: Parameters<PlanStore["updateItem"]>[1]) => store.updateItem(item, patch, { silent: false });
  const recommendNote = cat.status(item.status).noteRecommended && !item.notes.trim();
  return (
    <aside className="anim-drawer fixed bottom-0 left-0 top-0 z-[70] flex w-[420px] max-w-[100vw] flex-col border-r border-ink-200 bg-white shadow-pop" data-testid="item-panel">
      <div className="flex items-start gap-2 border-b border-ink-100 px-5 pb-3 pt-4">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-500">
            <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono">ID {item.id}</span>
            <span>{place.domain}{place.team !== place.domain ? ` / ${place.team}` : ""}</span>
          </div>
          {editable ? (
            <input className="w-full rounded-md border border-transparent px-1 -mx-1 py-0.5 text-[16px] font-semibold text-ink-900 outline-none hover:border-ink-200 focus:border-brand-500"
              value={name} onChange={(e) => { dirtyName.current = true; setName(e.target.value); }} data-testid="panel-name"
              onBlur={() => { dirtyName.current = false; if (name.trim() && name.trim() !== item.name) void save({ name: name.trim() }); else setName(item.name); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          ) : <h2 className="text-[16px] font-semibold text-ink-900">{item.name}</h2>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="סגור"><X size={16} /></button>
      </div>
      {!editable && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-md bg-ink-50 px-3 py-2 text-[12px] text-ink-500">
          <Lock size={13} /> {store.readOnly ? (store.kind === "live" ? "מצב צפייה בלבד פעיל — לעריכה כבה אותו בסרגל העליון" : "תצוגת Snapshot — צפייה בלבד") : "אין לך הרשאת עריכה לתחום זה — צפייה בלבד"}
        </div>
      )}
      {store.kind === "live" && (
        <div className="flex gap-1 px-5 pt-3">
          {(["details", "history"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={clsx("rounded-md px-2.5 py-1 text-[12.5px] font-medium", tab === t ? "bg-ink-100 text-ink-900" : "text-ink-500 hover:text-ink-900")}>
              {t === "details" ? "פרטים" : <span className="flex items-center gap-1"><History size={13} />היסטוריית שינויים</span>}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto px-5 py-4">
        {tab === "details" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="p-status">סטטוס</label>
                <StatusSelect id="p-status" value={item.status} disabled={!editable} onChange={(s) => void save({ status: s })} />
              </div>
              <div>
                <label className="label" htmlFor="p-priority">תיעדוף</label>
                <PrioritySelect id="p-priority" value={item.priority} disabled={!editable} onChange={(p) => void save({ priority: p })} />
              </div>
            </div>
            {recommendNote && editable && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                מומלץ להוסיף הסבר בשדה ההערות לסטטוס &quot;{cat.status(item.status).label}&quot;.
              </div>
            )}
            <div>
              <label className="label">שבוע התחלה</label>
              <WeekPicker value={item.startWeek} disabled={!editable}
                onChange={(v) => void save(v > item.endWeek ? { startWeek: v, endWeek: v } : { startWeek: v })} />
            </div>
            <div>
              <label className="label">שבוע סיום</label>
              <WeekPicker value={item.endWeek} min={item.startWeek} disabled={!editable}
                onChange={(v) => { if (v >= item.startWeek) void save({ endWeek: v }); }} />
            </div>
            <div>
              <label className="label" htmlFor="p-notes">הערות</label>
              <textarea id="p-notes" className="input min-h-[110px]" disabled={!editable} value={notes} placeholder={editable ? "הוסף הערה…" : ""}
                onChange={(e) => { dirtyNotes.current = true; setNotes(e.target.value); }} onBlur={() => { dirtyNotes.current = false; if (notes !== item.notes) void save({ notes }); }} />
            </div>
            <DependenciesEditor item={item} data={data} editable={editable} onChange={(dependencies) => void save({ dependencies })} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-ink-50 px-3 py-2.5 text-[12px]">
              <dt className="text-ink-500">נוצר על ידי</dt><dd>{userName(data, item.createdById)} · {fmtTs(item.createdAt)}</dd>
              <dt className="text-ink-500">עודכן לאחרונה</dt><dd>{userName(data, item.updatedById)} · {fmtTs(item.updatedAt)}</dd>
              <dt className="text-ink-500">טווח</dt><dd>{weekLabel(item.startWeek)} – {weekLabel(item.endWeek)}</dd>
            </dl>
          </div>
        ) : <ItemHistory id={item.id} />}
      </div>
      {editable && (
        <div className="flex items-center gap-2 border-t border-ink-100 px-5 py-3">
          <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={async () => {
            if (await confirm({ title: "מחיקת תכולה", text: <>האם אתה בטוח שברצונך למחוק את &quot;{item.name}&quot;?<span className="mt-1.5 block text-[12px] text-ink-500">אם תרצה לשחזר, התכולה תהיה זמינה ב-{DELETED_RETENTION_DAYS} הימים הקרובים תחת &quot;תכולות שנמחקו&quot; (עם אותו ID).</span></>, confirm: "מחיקה", danger: true })) {
              await store.deleteItem(item); onClose();
            }
          }}><Trash2 size={14} />מחיקת תכולה</button>
        </div>
      )}
    </aside>
  );
}

function ItemHistory({ id }: { id: number }) {
  const q = useQuery({
    queryKey: ["history", "item", id],
    queryFn: () => api<{ id: number; at: string; action: string; summary: string; userName: string | null }[]>("GET", `/api/history?type=item&id=${id}`),
  });
  if (q.isLoading) return <div className="text-ink-500">טוען…</div>;
  if (!q.data?.length) return <div className="text-ink-500">אין היסטוריה.</div>;
  return (
    <ol className="relative space-y-3 border-r border-ink-200 pr-4">
      {q.data.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute -right-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
          <div className="text-[12px] text-ink-500">{fmtTs(h.at)} · {h.userName ?? "—"}</div>
          <div className="text-[13px] text-ink-900">{h.summary || h.action}</div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// הוספת תכולה
// ---------------------------------------------------------------------------
function NewItemDialog({ store, prefill, onClose, onCreated, onScheduled }: {
  store: PlanStore; prefill: NewItemPrefill; onClose: () => void; onCreated: (it: ItemDTO | null) => void; onScheduled: (it: ItemDTO) => void;
}) {
  const data = store.data!;
  const router = useRouter();
  const qc = useQueryClient();
  const bl = prefill.backlog;
  const toast = useToast();
  const cat = useCatalog();
  const initialTarget = (() => {
    if (prefill.rowId) {
      const r = data.rows.find((x) => x.id === prefill.rowId);
      if (r) return r.kind === "TEAM" ? `team:${r.teamId}` : `cross:${r.id}`;
    }
    if (prefill.teamId) return `team:${prefill.teamId}`;
    return "";
  })();
  const [target, setTarget] = useState(initialTarget);
  const [rowChoice, setRowChoice] = useState<string>(prefill.rowId ? String(prefill.rowId) : "auto");
  const cw = currentWeekIL();
  const [f, setF] = useState({
    name: prefill.name ?? "", startWeek: prefill.startWeek ?? cw, endWeek: prefill.endWeek ?? prefill.startWeek ?? cw,
    status: prefill.status ?? cat.defaultStatus, priority: prefill.priority ?? cat.defaultPriority, notes: prefill.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const teamId = target.startsWith("team:") ? Number(target.slice(5)) : null;
  const teamRows = teamId ? data.rows.filter((r) => r.kind === "TEAM" && r.teamId === teamId).sort((a, b) => a.sortOrder - b.sortOrder) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) { toast.show("error", "יש להזין שם תכולה"); return; }
    if (!target) { toast.show("error", "יש לבחור צוות"); return; }
    if (f.endWeek < f.startWeek) { toast.show("error", "שבוע הסיום אינו יכול להיות לפני שבוע ההתחלה"); return; }
    setBusy(true);
    let rowId: number | null = null;
    let createdRow = false;
    if (target.startsWith("cross:")) rowId = Number(target.slice(6));
    else if (rowChoice === "new") { rowId = await store.createRow(teamId!); createdRow = true; }
    else if (rowChoice === "auto") {
      // השורה הראשונה שאין בה חפיפה בטווח; אם אין — שורה חדשה
      const free = teamRows.find((r) => !data.items.some((i) => i.rowId === r.id && i.startWeek <= f.endWeek && i.endWeek >= f.startWeek));
      if (free) rowId = free.id; else { rowId = await store.createRow(teamId!); createdRow = true; }
    } else rowId = Number(rowChoice);
    if (!rowId) { setBusy(false); return; }
    const v = { rowId, name: f.name.trim(), startWeek: f.startWeek, endWeek: f.endWeek, status: f.status, priority: f.priority, notes: f.notes };
    let it: ItemDTO | null = null;
    if (bl) {
      // העברה מהבאקלוג: בשרת, בטרנזקציה אחת — נוצרת תכולה והפריט יוצא מהבאקלוג
      try {
        it = await api<ItemDTO>("POST", `/api/backlog/${bl.id}/schedule`, { version: bl.version, item: v });
        store.refresh();
        void qc.invalidateQueries({ queryKey: ["backlog"] });
      } catch (er) { toast.show("error", (er as Error).message); }
    } else it = await store.createItem(v);
    setBusy(false);
    if (it) { if (bl) onScheduled(it); else onCreated(it); }
    else if (createdRow) { // היצירה נכשלה — לא משאירים שורה ריקה שנוצרה עבורה
      const row = store.data?.rows.find((r) => r.id === rowId);
      if (row) await store.deleteRow(row, { silent: true });
    }
  }

  return (
    <Dialog open onClose={onClose} title={bl ? "העברה לגאנט" : "הוספת תכולה"} width={520}
      footer={<>
        <button className="btn-primary" form="new-item-form" disabled={busy} data-testid="new-item-submit">{busy ? "שומר…" : bl ? "העברה לגאנט" : "הוספה"}</button>
        {bl && !bl.onGantt && (
          <button className="btn-secondary" onClick={() => { onClose(); router.push(`/plan?view=gantt&place=${bl.id}`); }} data-testid="pick-on-gantt"
            title="מעבר לגאנט: מסמנים את טווח השבועות ישירות בשורה של הצוות">
            <GanttChartSquare size={14} />בחירה על גבי הגאנט
          </button>
        )}
        <button className="btn-ghost" onClick={onClose}>ביטול</button>
      </>}>
      <form id="new-item-form" onSubmit={submit} className="space-y-3.5">
        {bl && (
          <p className="flex items-start gap-1.5 rounded-md bg-brand-50 px-3 py-2 text-[12.5px] text-brand-700">
            <Info size={14} className="mt-0.5 shrink-0" />בחר שבוע התחלה וסיום. הפריט ייצא מהבאקלוג ויוצג בגאנט ובדף התכולות לכל המשתמשים.
          </p>
        )}
        {bl && !target && (
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-amber-700" data-testid="schedule-need-team">
            <AlertTriangle size={14} />לפריט לא נבחר צוות בבאקלוג — יש לבחור צוות כדי להעביר לגאנט
          </p>
        )}
        <div>
          <label className="label" htmlFor="ni-name">שם התכולה *</label>
          <input id="ni-name" className="input" data-autofocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="לדוגמה: מודול דוחות" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">תחום / צוות *</label>
            <TargetSelect data={data} store={store} value={target} onChange={(v) => { setTarget(v); setRowChoice("auto"); }} />
          </div>
          <div>
            <label className="label">שורה</label>
            <select className="input" value={rowChoice} disabled={!teamId} onChange={(e) => setRowChoice(e.target.value)}>
              <option value="auto">אוטומטי (שורה פנויה)</option>
              {teamRows.map((r, i) => <option key={r.id} value={r.id}>שורה {i + 1}</option>)}
              <option value="new">שורה חדשה</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="label">שבוע התחלה</label><WeekPicker value={f.startWeek} onChange={(v) => setF({ ...f, startWeek: v, endWeek: f.endWeek < v ? v : f.endWeek })} /></div>
          <div><label className="label">שבוע סיום</label><WeekPicker value={f.endWeek} min={f.startWeek} onChange={(v) => setF({ ...f, endWeek: v })} /></div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="label">סטטוס</label><StatusSelect value={f.status} onChange={(s) => setF({ ...f, status: s })} /></div>
          <div><label className="label">תיעדוף</label><PrioritySelect value={f.priority} onChange={(p) => setF({ ...f, priority: p })} /></div>
        </div>
        {cat.status(f.status).noteRecommended && !f.notes.trim() && (
          <div className="flex items-center gap-2 text-[12px] text-amber-700"><Info size={13} />מומלץ להוסיף הסבר בהערות לסטטוס זה.</div>
        )}
        <div><label className="label">הערות</label><textarea className="input min-h-[70px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// אבני דרך
// ---------------------------------------------------------------------------
/** שיוך אבן דרך: רוחבי (כל הארגון) / תחום שלם / צוות. ערכים לפי msScopeValue */
function ScopeSelect({ data, store, value, onChange }: { data: PlanData; store: PlanStore; value: string; onChange: (v: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} data-testid="ms-scope">
      {store.canEditCross() && <option value="cross">רוחבי (כל הארגון)</option>}
      {data.domains.map((d) => {
        const teams = data.teams.filter((t) => t.domainId === d.id && store.canEditTeam(t.id));
        if (!teams.length) return null;
        return (
          <optgroup key={d.id} label={d.name}>
            {/* תחום עם צוות יחיד — הצוות הוא התחום, אין צורך באפשרות נפרדת */}
            {!d.isSingleTeam && store.canEditDomain(d.id) && <option value={`d:${d.id}`}>{d.name} — כל התחום</option>}
            {teams.map((t) => <option key={t.id} value={String(t.id)}>{d.isSingleTeam ? d.name : `${d.name} / ${t.name}`}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}

function MilestoneDialog({ store, m, prefill, onClose }: { store: PlanStore; m: MilestoneDTO | null; prefill?: MsPrefill; onClose: () => void }) {
  const data = store.data!;
  const confirm = useConfirm();
  const editable = m ? msCanEdit(m, store) : true;
  const defaultScope = m ? msScopeValue(m)
    : prefill?.domainId ? `d:${prefill.domainId}`
    : prefill?.teamId === null ? "cross" : prefill?.teamId ? String(prefill.teamId)
    : store.canEditCross() ? "cross" : String(data.teams.find((t) => store.canEditTeam(t.id))?.id ?? "");
  const [f, setF] = useState({ name: m?.name ?? "", date: m?.date ?? prefill?.date ?? todayIL(), scope: defaultScope, notes: m?.notes ?? "" });
  const toast = useToast();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || !isISODate(f.date) || !f.scope) { toast.show("error", "יש למלא שם, תאריך ושיוך"); return; }
    const v = { name: f.name.trim(), date: f.date, ...parseMsScope(f.scope), notes: f.notes };
    const ok = m ? await store.updateMilestone(m, v) : await store.createMilestone(v);
    if (ok) onClose(); // בכישלון החלון נשאר פתוח — הקלט לא אובד
  }
  return (
    <Dialog open onClose={onClose} title={<span className="flex items-center gap-2"><Diamond size={16} className="text-violet-600" />{m ? (editable ? "עריכת אבן דרך" : "אבן דרך") : "אבן דרך חדשה"}</span>}
      footer={editable ? <>
        <button className="btn-primary" form="ms-form">שמירה</button>
        <button className="btn-secondary" onClick={onClose}>ביטול</button>
        {m && <button className="btn-ghost mr-auto text-red-600 hover:bg-red-50" onClick={async () => {
          if (await confirm({ title: "מחיקת אבן דרך", text: `למחוק את "${m.name}"?`, confirm: "מחיקה", danger: true })) { await store.deleteMilestone(m); onClose(); }
        }}><Trash2 size={14} />מחיקה</button>}
      </> : <button className="btn-secondary" onClick={onClose}>סגירה</button>}>
      <form id="ms-form" onSubmit={submit} className="space-y-3">
        <fieldset disabled={!editable} className="space-y-3">
          <div><label className="label">שם *</label><input className="input" data-autofocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="לדוגמה: הצגת תוכנית רבעונית" /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">תאריך *</label><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div><label className="label">שיוך</label><ScopeSelect data={data} store={store} value={f.scope} onChange={(v) => setF({ ...f, scope: v })} /></div>
          </div>
          <div><label className="label">הערות</label><textarea className="input min-h-[60px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </fieldset>
        {m && <p className="text-[11.5px] text-ink-400">נוצר ע״י {userName(data, m.createdById)} · {fmtTs(m.createdAt)} · עודכן {fmtTs(m.updatedAt)}</p>}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ספרינטים
// ---------------------------------------------------------------------------
function SprintDialog({ store, s, prefill, onClose }: { store: PlanStore; s: SprintDTO | null; prefill?: SprintPrefill; onClose: () => void }) {
  const data = store.data!;
  const confirm = useConfirm();
  const toast = useToast();
  const editable = s ? store.canEditDomain(s.domainId) : true;
  const start = s?.startDate ?? prefill?.startDate ?? currentWeekIL();
  const editableDomains = data.domains.filter((d) => store.canEditDomain(d.id));
  const [f, setF] = useState({
    name: s?.name ?? prefill?.name ?? "", startDate: start, endDate: s?.endDate ?? prefill?.endDate ?? addDays(start, 11),
    domainId: String(s?.domainId ?? prefill?.domainId ?? editableDomains[0]?.id ?? ""), notes: s?.notes ?? "",
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || !f.domainId) { toast.show("error", "יש למלא שם ושיוך לתחום"); return; }
    if (f.endDate < f.startDate) { toast.show("error", "תאריך הסיום אינו יכול להיות לפני תאריך ההתחלה"); return; }
    const v = { name: f.name.trim(), startDate: f.startDate, endDate: f.endDate, domainId: Number(f.domainId), notes: f.notes };
    const ok = s ? await store.updateSprint(s, v) : await store.createSprint(v);
    if (ok) onClose();
  }
  return (
    <Dialog open onClose={onClose} title={<span className="flex items-center gap-2"><Flag size={16} className="text-teal-600" />{s ? (editable ? "עריכת ספרינט" : "ספרינט") : "ספרינט חדש"}</span>}
      footer={editable ? <>
        <button className="btn-primary" form="sp-form">שמירה</button>
        <button className="btn-secondary" onClick={onClose}>ביטול</button>
        {s && <button className="btn-ghost mr-auto text-red-600 hover:bg-red-50" onClick={async () => {
          if (await confirm({ title: "מחיקת ספרינט", text: `למחוק את "${s.name}"?`, confirm: "מחיקה", danger: true })) { await store.deleteSprint(s); onClose(); }
        }}><Trash2 size={14} />מחיקה</button>}
      </> : <button className="btn-secondary" onClick={onClose}>סגירה</button>}>
      <form id="sp-form" onSubmit={submit}>
        <fieldset disabled={!editable} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">שם *</label><input className="input" data-autofocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sprint 12" /></div>
            <div>
              <label className="label">תחום *</label>
              <select className="input" value={f.domainId} onChange={(e) => setF({ ...f, domainId: e.target.value })} data-testid="sprint-domain">
                {(editable && !s ? editableDomains : data.domains.filter((d) => editableDomains.includes(d) || d.id === s?.domainId)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-ink-400">הספרינט חל על כל הצוותים בתחום.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">תאריך התחלה</label><input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
            <div><label className="label">תאריך סיום</label><input type="date" className="input" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
          </div>
          <div><label className="label">הערות</label><textarea className="input min-h-[60px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </fieldset>
        {s && <p className="mt-2 text-[11.5px] text-ink-400">{fmtDate(s.startDate)} – {fmtDate(s.endDate)}</p>}
      </form>
    </Dialog>
  );
}

export const useStableCallback = useCallback;
