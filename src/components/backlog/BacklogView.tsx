"use client";
// באקלוג: פריטים שעוד לא שובצו בזמן, לפי תחום (הצוות לא חובה). גלוי רק למי שמורשה לערוך את התחום (וכך גם השרת אוכף).
// קליק ימני על פריט → "העברה לגאנט": בוחרים שבועות (בחלון או ישירות על הגאנט) והפריט הופך לתכולה רגילה.
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarPlus, ChevronDown, Lock, Plus, Search, Trash2, Users, X } from "lucide-react";
import type { BacklogDTO, Me } from "@/lib/types";
import { api } from "@/lib/api";
import { useCatalog } from "@/components/CatalogProvider";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog";
import { Floating, MenuItem } from "@/components/ui/popover";
import type { PlanStore } from "@/components/plan/store";
import { PrioritySelect, useWorkspaceUI, userName } from "@/components/plan/ui";

export const BACKLOG_KEY = ["backlog"];

type Row = { b: BacklogDTO; group: string; domain: string; team: string | null; domainOrder: number; teamOrder: number; editable: boolean };
type Draft = { domainId: string; teamId: string; name: string; priority: string; notes: string };

export function BacklogView({ store, me }: { store: PlanStore; me: Me }) {
  const data = store.data!;
  const qc = useQueryClient();
  const toast = useToast();
  const cat = useCatalog();
  const ui = useWorkspaceUI();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: BACKLOG_KEY, queryFn: () => api<BacklogDTO[]>("GET", "/api/backlog") });
  const [search, setSearch] = useState("");
  // שורת הוספה בתחתית הטבלה: ממלאים את השדות ישירות בשורה, Enter שומר ופותח שורה ריקה נוספת
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: Row } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const access = (domainId: number) => me.role === "SUPER" || me.domainIds.includes(domainId);
  const editableDomains = store.readOnly ? [] : data.domains.filter((d) => access(d.id));
  const canUse = me.role === "SUPER" || me.domainIds.length > 0;

  const rows: Row[] = useMemo(() => {
    const dMap = new Map(data.domains.map((d) => [d.id, d]));
    const s = search.trim().toLowerCase();
    return (q.data ?? []).flatMap((b) => {
      const d = dMap.get(b.domainId);
      if (!d) return [];
      const t = b.teamId !== null ? data.teams.find((x) => x.id === b.teamId) : undefined;
      if (s && !b.name.toLowerCase().includes(s) && !b.notes.toLowerCase().includes(s) && String(b.id) !== s) return []; // ID — חיפוש בלבד
      return [{ b, group: `${d.id}:${t?.id ?? 0}`, domain: d.name, team: t ? t.name : null, domainOrder: d.sortOrder, teamOrder: t ? t.sortOrder : 1e9, editable: access(d.id) }];
    }).sort((a, b) => a.domainOrder - b.domainOrder || a.teamOrder - b.teamOrder // "ללא צוות" בסוף התחום
      || cat.priority(a.b.priority).sortOrder - cat.priority(b.b.priority).sortOrder || a.b.id - b.b.id);
  }, [q.data, data, search, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) m.set(r.group, (m.get(r.group) ?? 0) + 1); return m; }, [rows]);
  const domainOfTeam = (teamId: string) => String(data.teams.find((t) => t.id === Number(teamId))?.domainId ?? "");

  /** בחירת צוות (כל הצוותים בתחומים שמותר לערוך). צוות מתחום אחר מחליף גם את התחום */
  const teamOptions = (
    <>
      <option value="">— ללא צוות —</option>
      {editableDomains.map((d) => {
        const ts = data.teams.filter((t) => t.domainId === d.id).sort((a, b) => a.sortOrder - b.sortOrder);
        return ts.length ? <optgroup key={d.id} label={d.name}>{ts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup> : null;
      })}
    </>
  );

  const refresh = () => qc.invalidateQueries({ queryKey: BACKLOG_KEY });
  const patch = async (b: BacklogDTO, p: Partial<Pick<BacklogDTO, "name" | "priority" | "notes" | "teamId" | "domainId">>) => {
    try { await api("PATCH", `/api/backlog/${b.id}`, { version: b.version, patch: p }); }
    catch (e) { toast.show("error", (e as Error).message); }
    await refresh();
  };
  const remove = async (b: BacklogDTO) => {
    if (!(await confirm({ title: "מחיקה מהבאקלוג", text: <>למחוק את &quot;{b.name}&quot; מהבאקלוג?</>, confirm: "מחיקה", danger: true }))) return;
    try { await api("DELETE", `/api/backlog/${b.id}`); toast.show("success", "נמחק מהבאקלוג"); }
    catch (e) { toast.show("error", (e as Error).message); }
    await refresh();
  };
  const startDraft = () => {
    // תחום: חובה. למי שיש תחום אחד — נבחר אוטומטית; למי שיש כמה — בוחרים
    setDraft((d) => d ?? { domainId: editableDomains.length === 1 ? String(editableDomains[0].id) : "", teamId: "", name: "", priority: cat.defaultPriority, notes: "" });
    setTimeout(() => { nameRef.current?.scrollIntoView({ block: "nearest" }); nameRef.current?.focus(); }, 0);
  };
  const saveDraft = async () => {
    if (!draft || saving) return;
    if (!draft.name.trim()) { nameRef.current?.focus(); return; }
    if (!draft.domainId) { toast.show("error", "יש לבחור תחום"); return; }
    setSaving(true);
    try {
      await api("POST", "/api/backlog", {
        name: draft.name.trim(), domainId: Number(draft.domainId), teamId: draft.teamId ? Number(draft.teamId) : null, priority: draft.priority, notes: draft.notes,
      });
      await refresh();
      setDraft({ ...draft, name: "", notes: "" }); // נשארים באותו תחום, צוות ותיעדוף — להזנה מהירה של כמה פריטים
      setTimeout(() => nameRef.current?.focus(), 0);
    } catch (e) { toast.show("error", (e as Error).message); }
    setSaving(false);
  };
  const draftKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void saveDraft(); }
    if (e.key === "Escape") setDraft(null);
  };
  const canAdd = editableDomains.length > 0;
  // צוות לא נבחר בבאקלוג → בחלון ההעברה חייבים לבחור צוות
  const schedule = (r: Row) => ui.openNewItem({
    teamId: r.b.teamId ?? undefined, name: r.b.name, priority: r.b.priority, notes: r.b.notes, backlog: { id: r.b.id, version: r.b.version },
  });

  if (!canUse) {
    return <div className="p-10 text-center text-ink-500">הבאקלוג זמין למי שיש לו הרשאת עריכה לתחום. אפשר לבקש הרשאות ב&quot;הגדרות&quot; (בתפריט השם למעלה).</div>;
  }
  const cell = "border-b border-l border-ink-100 px-2 align-middle";
  let lastGroup = "";
  return (
    <div className="flex h-full flex-col" data-testid="backlog-view">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-white px-4 py-2">
        <p className="flex items-center gap-1.5 rounded-md bg-brand-50 px-2.5 py-1 text-[12.5px] text-brand-700" data-testid="backlog-note">
          <Users size={14} />רשימה זו משותפת רק עם מי שיש לו הרשאת עריכה לתחום שלך
        </p>
        <span className="text-[11.5px] text-ink-400">קליק ימני על פריט ← העברה לגאנט</span>
        <div className="mr-auto flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input h-8 w-[220px] pr-7 text-[12.5px]" placeholder="חיפוש בבאקלוג…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {canAdd && <button className="btn-primary btn-sm" onClick={startDraft} data-testid="backlog-add"><Plus size={14} />הוספה לבאקלוג</button>}
        </div>
      </div>
      {store.readOnly && (
        <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-1.5 text-[12px] text-ink-500"><Lock size={12} />מצב צפייה בלבד — אי אפשר לשנות את הבאקלוג</div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[12.5px]" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 130 }} /><col style={{ width: 150 }} /><col /><col style={{ width: 110 }} /><col style={{ width: "30%" }} /><col style={{ width: 130 }} />
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              {["תחום", "צוות", "שם", "תיעדוף", "הערות", "מי הזין"].map((h) => (
                <th key={h} className="border-b border-l border-ink-200 bg-[var(--header)] px-2 py-2 text-start font-semibold text-ink-700">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={6} className="p-12 text-center text-ink-400">טוען…</td></tr>}
            {q.data && rows.length === 0 && (
              <tr><td colSpan={6} className="p-10 text-center text-ink-500">{search ? "אין פריטים שמתאימים לחיפוש" : "הבאקלוג ריק. הוסף פריט ראשון בשורה שלמטה."}</td></tr>
            )}
            {rows.flatMap((r) => {
              const out: React.ReactNode[] = [];
              const isCollapsed = collapsed.has(r.group);
              if (r.group !== lastGroup) {
                lastGroup = r.group;
                out.push(
                  <tr key={`g${r.group}`}>
                    <td colSpan={6} className="border-b border-ink-200 bg-ink-50 p-0">
                      <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-ink-700 hover:text-ink-900" aria-expanded={!isCollapsed}
                        onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(r.group)) n.delete(r.group); else n.add(r.group); return n; })}>
                        <ChevronDown size={14} className={clsx("text-ink-400 transition-transform", isCollapsed && "rotate-90")} />
                        {r.domain}{r.team === null ? <span className="font-medium text-ink-400"> / ללא צוות</span> : r.team !== r.domain ? <span className="font-medium text-ink-500"> / {r.team}</span> : null}
                        <span className="mr-1 font-normal text-ink-400">({counts.get(r.group) ?? 0})</span>
                      </button>
                    </td>
                  </tr>,
                );
              }
              if (isCollapsed) return out;
              const ed = r.editable && !store.readOnly;
              out.push(
                <tr key={r.b.id} className="group hover:bg-brand-50/40" data-backlog-row={r.b.id} style={{ height: 34 }}
                  onContextMenu={(e) => { if ((e.target as HTMLElement).closest("input, textarea, select")) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, row: r }); }}>
                  <td className={clsx(cell, "p-0 font-medium text-ink-700")}>
                    {ed && editableDomains.length > 1 ? (
                      <CellSelect value={r.b.domainId} onChange={(v) => void patch(r.b, { domainId: Number(v) })} label="תחום" testid={`backlog-domain-${r.b.id}`}>
                        {editableDomains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </CellSelect>
                    ) : <span className="block truncate px-2">{r.domain}</span>}
                  </td>
                  <td className={clsx(cell, "p-0 text-ink-700")}>
                    {ed ? (
                      <CellSelect value={r.b.teamId ?? ""} onChange={(v) => void patch(r.b, { teamId: v ? Number(v) : null })} label="צוות" testid={`backlog-team-${r.b.id}`}
                        className={r.b.teamId === null ? "text-ink-400" : undefined}>{teamOptions}</CellSelect>
                    ) : <span className={clsx("block truncate px-2", r.team === null && "text-ink-300")}>{r.team ?? "ללא צוות"}</span>}
                  </td>
                  <td className={cell}><TextCell value={r.b.name} editable={ed} onSave={(v) => void patch(r.b, { name: v })} testid={`backlog-name-${r.b.id}`} /></td>
                  <td className={clsx(cell, "p-0")}>
                    {/* כמו בדף התכולות: נראה כטקסט צבוע, ולחיצה פותחת את הבחירה */}
                    <CellSelect value={r.b.priority} disabled={!ed} onChange={(v) => void patch(r.b, { priority: v })} label="תיעדוף" testid={`backlog-priority-${r.b.id}`}
                      style={{ color: r.b.priority === cat.defaultPriority ? "#94a3b8" : cat.priority(r.b.priority).color, fontWeight: r.b.priority === cat.defaultPriority ? 400 : 600 }}>
                      {cat.priorities.map((p) => <option key={p.key} value={p.key} style={{ color: "#0f172a" }}>{p.label}</option>)}
                      {!cat.priorities.some((p) => p.key === r.b.priority) && <option value={r.b.priority}>{cat.priority(r.b.priority).label}</option>}
                    </CellSelect>
                  </td>
                  <td className={cell}><NotesCell value={r.b.notes} editable={ed} onSave={(v) => void patch(r.b, { notes: v })} /></td>
                  <td className={clsx(cell, "truncate text-ink-500")}>{userName(data, r.b.createdById)}</td>
                </tr>,
              );
              return out;
            })}
            {canAdd && q.data && (draft ? (
              <tr className="bg-brand-50/50" data-testid="backlog-new-row" onKeyDown={draftKeys}>
                <td className={clsx(cell, "px-1")}>
                  {editableDomains.length > 1 ? (
                    <select className={clsx("input h-7 px-1 text-[12px]", !draft.domainId && "border-amber-400")} value={draft.domainId} aria-label="תחום" data-testid="backlog-new-domain"
                      onChange={(e) => setDraft({ ...draft, domainId: e.target.value, teamId: draft.teamId && domainOfTeam(draft.teamId) !== e.target.value ? "" : draft.teamId })}>
                      <option value="" disabled>בחר תחום…</option>
                      {editableDomains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  ) : <span className="block truncate px-1 text-ink-500">{editableDomains[0]?.name}</span>}
                </td>
                <td className={clsx(cell, "px-1")}>
                  <select className={clsx("input h-7 px-1 text-[12px]", !draft.teamId && "text-ink-400")} value={draft.teamId} aria-label="צוות (לא חובה)" data-testid="backlog-new-team"
                    onChange={(e) => setDraft({ ...draft, teamId: e.target.value, domainId: e.target.value ? domainOfTeam(e.target.value) : draft.domainId })}>{teamOptions}</select>
                </td>
                <td className={clsx(cell, "px-1")}>
                  <input ref={nameRef} className="input h-7 text-[12.5px]" placeholder="שם הפריט…" value={draft.name} maxLength={300}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="backlog-new-name" />
                </td>
                <td className={clsx(cell, "px-1")}><PrioritySelect value={draft.priority} onChange={(p) => setDraft({ ...draft, priority: p })} /></td>
                <td className={clsx(cell, "px-1")}>
                  <input className="input h-7 text-[12.5px]" placeholder="הערות (לא חובה)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} data-testid="backlog-new-notes" />
                </td>
                <td className={clsx(cell, "px-1")}>
                  <div className="flex items-center gap-1">
                    <button className="btn-primary btn-sm h-7 px-2" disabled={saving || !draft.name.trim()} onClick={() => void saveDraft()} title="שמירה (Enter)" data-testid="backlog-new-save">שמירה</button>
                    <button className="icon-btn h-7 w-7" onClick={() => setDraft(null)} title="ביטול (Esc)" aria-label="ביטול"><X size={14} /></button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={6} className="border-b border-ink-100 p-0">
                  <button className="flex w-full items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium text-brand-700 hover:bg-brand-50" onClick={startDraft} data-testid="backlog-add-row">
                    <Plus size={14} />הוספת פריט
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Floating open={!!menu} point={menu ?? undefined} onClose={() => setMenu(null)}>
        {menu && (
          <div className="w-[230px] p-1" onClick={() => setMenu(null)} data-testid="backlog-menu">
            <div className="truncate px-2.5 pb-1 pt-1 text-[11px] font-semibold text-ink-500">{menu.row.b.name}</div>
            {menu.row.editable && !store.readOnly ? (
              <>
                <MenuItem icon={<CalendarPlus size={14} />} onClick={() => schedule(menu.row)}><span data-testid="backlog-schedule">העברה לגאנט (שיבוץ בשבועות)</span></MenuItem>
                <MenuItem icon={<Trash2 size={14} />} danger onClick={() => void remove(menu.row.b)}>מחיקה מהבאקלוג</MenuItem>
              </>
            ) : <div className="px-2.5 py-1.5 text-[12px] text-ink-400">אין אפשרות עריכה</div>}
          </div>
        )}
      </Floating>
    </div>
  );
}

/** בחירה בתוך תא בטבלה: נראית כטקסט (בלי מסגרת וחץ), ולחיצה פותחת את רשימת האפשרויות — כמו בדף התכולות */
function CellSelect({ value, onChange, disabled, label, testid, className, style, children }: {
  value: string | number; onChange: (v: string) => void; disabled?: boolean; label: string; testid?: string;
  className?: string; style?: React.CSSProperties; children: React.ReactNode;
}) {
  return (
    <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} data-testid={testid} style={style}
      className={clsx("h-full w-full appearance-none truncate bg-transparent px-2 py-2 outline-none", !disabled && "cursor-pointer hover:bg-ink-50", className)}>
      {children}
    </select>
  );
}

function TextCell({ value, editable, onSave, testid }: { value: string; editable: boolean; onSave: (v: string) => void; testid?: string }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  if (edit) {
    return (
      <input autoFocus className="input h-7" value={v} onChange={(e) => setV(e.target.value)} data-testid={testid ? `${testid}-input` : undefined}
        onBlur={() => { setEdit(false); if (v.trim() && v.trim() !== value) onSave(v.trim()); else setV(value); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(value); setEdit(false); } }} />
    );
  }
  return (
    <div className={clsx("truncate rounded px-1 -mx-1 py-0.5 font-medium text-ink-900", editable && "cursor-text hover:bg-ink-100")}
      onClick={() => { if (editable) { setV(value); setEdit(true); } }} title={value} data-testid={testid}>{value}</div>
  );
}

function NotesCell({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); if (v !== value) onSave(v); };
  return (
    <>
      <div ref={ref} className={clsx("truncate rounded px-1 -mx-1 py-0.5", editable && "cursor-text hover:bg-ink-100", !value && "text-ink-300")}
        onClick={() => { if (editable) { setV(value); setOpen(true); } }} title={value}>
        {value || (editable ? "הוסף הערה…" : "—")}
      </div>
      <Floating anchor={ref.current} open={open} onClose={close}>
        <div className="w-[340px] p-2">
          <textarea autoFocus className="input min-h-[110px]" value={v} onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) close(); }} />
          <div className="mt-1.5"><button className="btn-primary btn-sm" onClick={close}>שמירה</button></div>
        </div>
      </Floating>
    </>
  );
}
