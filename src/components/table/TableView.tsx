"use client";
// תצוגת תכולות (Table View) — אותו מקור נתונים ואותן פעולות עדכון כמו הגאנט.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Layers, X, ChevronDown, ChevronsDownUp, ChevronsUpDown, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/dialog";
import { DELETED_RETENTION_DAYS } from "@/lib/constants";
import type { ItemDTO, Me, ViewConfig } from "@/lib/types";
import { useCatalog } from "@/components/CatalogProvider";
import { fmtDate, weekEndOf, weekNumber, weekYear } from "@/lib/weeks";
import { Floating, MenuItem } from "@/components/ui/popover";
import { LabelMenu } from "@/components/gantt/GanttView";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import type { PlanStore } from "@/components/plan/store";
import { useWorkspaceUI, placeLabel, userName, fmtTs } from "@/components/plan/ui";
import { itemMatches, timeWindow, visibleTeamIds } from "@/components/plan/filters";
import { WeekPicker } from "@/components/plan/WeekPicker";
import { currentPrefs, savePrefs, uiZoom } from "@/components/plan/prefs";

type ColKey = "domain" | "team" | "id" | "name" | "priority" | "status" | "notes" | "start" | "end" | "createdBy" | "updatedAt";
const COLS: { key: ColKey; label: string; w: number; sticky?: boolean }[] = [
  { key: "domain", label: "תחום", w: 110, sticky: true },
  { key: "team", label: "צוות", w: 130, sticky: true },
  { key: "name", label: "שם התכולה", w: 280 },
  { key: "priority", label: "תיעדוף", w: 100 },
  { key: "status", label: "סטטוס", w: 150 },
  { key: "notes", label: "הערות", w: 260 },
  { key: "start", label: "שבוע התחלה", w: 150 },
  { key: "end", label: "שבוע סיום", w: 150 },
  { key: "createdBy", label: "מי הזין", w: 130 },
  { key: "updatedAt", label: "עדכון אחרון", w: 150 },
  { key: "id", label: "ID", w: 60 }, // הכי שמאלית — מידע טכני
];
const CHECK_W = 0; // אין עמודת תיבות סימון — בחירה מרובה ב-Ctrl/Shift + לחיצה

type Row = { item: ItemDTO; domain: string; team: string; domainId: number; teamId: number; domainOrder: number; teamOrder: number; rowOrder: number; editable: boolean };

export const TableView = memo(function TableView({ store, view, setView, me }: { store: PlanStore; view: ViewConfig; setView?: (v: ViewConfig) => void; me: Me }) {
  const data = store.data!;
  const ui = useWorkspaceUI();
  const toast = useToast();
  const cat = useCatalog();
  const [sort, setSort] = useState<{ key: ColKey; dir: 1 | -1 } | null>(null);
  const [grouped, setGrouped] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [widths, setWidths] = useState<Record<string, number>>(() => ({ ...Object.fromEntries(COLS.map((c) => [c.key, c.w])), ...(currentPrefs(me.preferences).tableColumnWidths ?? {}) }));
  const saveWidths = useRef<ReturnType<typeof setTimeout> | null>(null);

  const win = timeWindow(view.time, data);
  const teamsVisible = useMemo(() => visibleTeamIds(data, view), [data, view]);
  const rows: Row[] = useMemo(() => {
    const dOrder = new Map(data.domains.map((d) => [d.id, d.sortOrder]));
    const tMap = new Map(data.teams.map((t) => [t.id, t]));
    const rMap = new Map(data.rows.map((r) => [r.id, r]));
    return data.items
      .filter((i) => {
        // בטבלת התכולות מוצגות רק תכולות של צוותים (המידע הרוחבי — רק בגאנט)
        if (rMap.get(i.rowId)?.kind !== "TEAM" || !teamsVisible.has(i.teamId!)) return false;
        return itemMatches(i, view, view.time.kind === "all" ? undefined : win);
      })
      .map((i) => {
        const p = placeLabel(data, i);
        const t = i.teamId ? tMap.get(i.teamId) : undefined;
        const r = rMap.get(i.rowId);
        return {
          item: i, domain: p.domain, team: p.team, domainId: t?.domainId ?? 0, teamId: i.teamId ?? 0,
          domainOrder: t ? dOrder.get(t.domainId) ?? 0 : -1, teamOrder: t?.sortOrder ?? (r?.kind === "INFLUENCE" ? 0 : 1),
          rowOrder: r?.sortOrder ?? 0, editable: store.canEditRow(r),
        };
      });
  }, [data, view, teamsVisible, win[0], win[1], store]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    const base = [...rows].sort((a, b) => a.domainOrder - b.domainOrder || a.teamOrder - b.teamOrder || a.item.startWeek.localeCompare(b.item.startWeek) || a.rowOrder - b.rowOrder || a.item.id - b.item.id);
    if (!sort) return base;
    const val = (r: Row): string | number => {
      switch (sort.key) {
        case "domain": return r.domainOrder;
        case "team": return r.domainOrder * 10000 + r.teamOrder;
        case "id": return r.item.id;
        case "name": return r.item.name;
        case "priority": return r.item.priority === cat.defaultPriority ? 1e9 : cat.priority(r.item.priority).sortOrder; // "ללא" בסוף
        case "status": return cat.status(r.item.status).sortOrder;
        case "notes": return r.item.notes;
        case "start": return r.item.startWeek;
        case "end": return r.item.endWeek;
        case "createdBy": return userName(data, r.item.createdById);
        case "updatedAt": return r.item.updatedAt;
      }
    };
    return base.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "he");
      return c * sort.dir;
    });
  }, [rows, sort, data, cat]);

  const groupedOn = grouped && (!sort || sort.key === "domain" || sort.key === "team");
  // מקטעים מכווצים (לפי צוות) — נשמר אישית
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set(currentPrefs(me.preferences).tableCollapsed ?? []));
  const setCollapsedSave = (next: Set<number>) => { setCollapsed(next); savePrefs({ tableCollapsed: [...next] }); };
  const toggleGroup = (teamId: number) => { const n = new Set(collapsed); if (n.has(teamId)) n.delete(teamId); else n.add(teamId); setCollapsedSave(n); };
  const groupCounts = useMemo(() => { const m = new Map<number, number>(); for (const r of sorted) m.set(r.teamId, (m.get(r.teamId) ?? 0) + 1); return m; }, [sorted]);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; domainId: number; teamId: number } | null>(null);
  // חיפוש שמאתר תכולה במקטע מכווץ — פותח את המקטע
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent<{ teamId: number | null }>).detail.teamId;
      setCollapsed((c) => { if (t === null || !c.has(t)) return c; const n = new Set(c); n.delete(t); savePrefs({ tableCollapsed: [...n] }); return n; });
    };
    window.addEventListener("wp:locate", h);
    return () => window.removeEventListener("wp:locate", h);
  }, []);
  const selItems = sorted.filter((r) => selected.has(r.item.id) && r.editable).map((r) => r.item);
  // בחירה מרובה: Ctrl/⌘+לחיצה מוסיף/מסיר שורה, Shift+לחיצה בוחר טווח. Escape מנקה.
  const anchor = useRef<number | null>(null);
  const onRowClick = (e: React.MouseEvent, r: Row) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    e.preventDefault(); e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    if (e.shiftKey && anchor.current !== null) {
      const ids = sorted.map((x) => x.item.id);
      const a = ids.indexOf(anchor.current), b = ids.indexOf(r.item.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(sorted.slice(lo, hi + 1).filter((x) => x.editable).map((x) => x.item.id)));
        return;
      }
    }
    anchor.current = r.item.id;
    if (!r.editable) return;
    setSelected((s) => { const n = new Set(s); if (n.has(r.item.id)) n.delete(r.item.id); else n.add(r.item.id); return n; });
  };
  useEffect(() => {
    if (!selected.size) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog]")) setSelected(new Set()); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [selected.size]);
  // קליק ימני על שורה: אם השורה בתוך הבחירה — הפעולה על כל הנבחרות; אחרת — על השורה בלבד
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; items: ItemDTO[]; one: Row } | null>(null);
  const onRowMenu = (e: React.MouseEvent, r: Row) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    e.preventDefault();
    const items = selected.has(r.item.id) && selItems.length > 1 ? selItems : [r.item];
    setRowMenu({ x: e.clientX, y: e.clientY, items, one: r });
  };

  const toggleSort = (k: ColKey) => setSort((s) => (!s || s.key !== k ? { key: k, dir: 1 } : s.dir === 1 ? { key: k, dir: -1 } : null));

  const onResize = (k: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = widths[k];
    const z = uiZoom();
    const move = (ev: MouseEvent) => setWidths((w) => ({ ...w, [k]: Math.max(50, Math.min(800, w0 + (x0 - ev.clientX) / z)) }));
    const up = () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      if (saveWidths.current) clearTimeout(saveWidths.current);
      saveWidths.current = setTimeout(() => {
        setWidths((w) => { savePrefs({ tableColumnWidths: w }); return w; });
      }, 300);
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };

  const stickyRight = (k: ColKey) => (k === "domain" ? CHECK_W : k === "team" ? CHECK_W + widths.domain : undefined);
  const totalW = CHECK_W + COLS.reduce((s, c) => s + widths[c.key], 0);

  let lastGroup = "";
  return (
    <div className="flex h-full flex-col" data-testid="table-view">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-white px-4 py-1.5 text-[12px]">
        <span className="text-ink-500">{sorted.length} תכולות</span>
        {!selItems.length && <span className="text-[11.5px] text-ink-400">· קליק ימני על שורה לפעולות · <span className="kbd">Ctrl</span>+לחיצה לבחירה מרובה</span>}
        <button className={clsx("btn-ghost btn-sm", grouped && "bg-ink-100")} onClick={() => setGrouped((g) => !g)}><Layers size={13} />קיבוץ לפי תחום וצוות</button>
        {sort && <button className="btn-ghost btn-sm" onClick={() => setSort(null)}><X size={12} />ביטול מיון</button>}
        {selItems.length > 0 && (
          <div className="mr-4 flex items-center gap-2 rounded-md bg-brand-50 px-2 py-1 text-brand-700" data-testid="bulk-bar">
            <span className="font-medium">{selItems.length} נבחרו</span>
            <select className="input h-7 w-auto py-0 text-[12px]" value="" onChange={async (e) => { if (e.target.value) { await store.bulkUpdate(selItems, { status: e.target.value }); } }} data-testid="bulk-status">
              <option value="">שינוי סטטוס…</option>
              {cat.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select className="input h-7 w-auto py-0 text-[12px]" value="" onChange={async (e) => { if (e.target.value) { await store.bulkUpdate(selItems, { priority: e.target.value }); } }}>
              <option value="">שינוי תיעדוף…</option>
              {cat.priorities.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>ניקוי בחירה</button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="border-separate border-spacing-0 text-[12.5px]" style={{ width: totalW, tableLayout: "fixed" }}>
          <colgroup>
            {COLS.map((c) => <col key={c.key} style={{ width: widths[c.key] }} />)}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={clsx("relative select-none border-b border-l border-ink-200 bg-[var(--header)] px-2 text-start font-semibold text-ink-700", c.sticky && "sticky z-30")}
                  style={{ right: stickyRight(c.key) }}>
                  <button className="flex w-full items-center gap-1 py-2 hover:text-ink-900" onClick={() => toggleSort(c.key)}>
                    <span className="truncate">{c.label}</span>
                    {sort?.key === c.key ? (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="text-ink-300" />}
                  </button>
                  <span className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-brand-200" onMouseDown={(e) => onResize(c.key, e)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={COLS.length} className="p-12 text-center text-ink-500">אין תכולות להצגה לפי הסינון הנוכחי</td></tr>
            )}
            {sorted.map((r) => {
              const g = `${r.domain} / ${r.team}`;
              const header = groupedOn && g !== lastGroup;
              lastGroup = g;
              const i = r.item;
              const cell = "border-b border-l border-ink-100 px-2 align-middle";
              const isCollapsed = groupedOn && collapsed.has(r.teamId);
              const headerRow = header && (
                <tr key={`g-${g}`} data-group={r.teamId}>
                  <td colSpan={COLS.length} className="border-b border-ink-200 bg-ink-50 p-0">
                    <button className="sticky right-0 flex items-center gap-1.5 px-3 py-1.5 text-start text-[12px] font-bold text-ink-700 hover:text-ink-900"
                      onClick={() => toggleGroup(r.teamId)} aria-expanded={!isCollapsed} title={isCollapsed ? "הצגת התכולות" : "מזעור"}
                      onContextMenu={(e) => { e.preventDefault(); setGroupMenu({ x: e.clientX, y: e.clientY, domainId: r.domainId, teamId: r.teamId }); }}>
                      <ChevronDown size={14} className={clsx("text-ink-400 transition-transform", isCollapsed && "rotate-90")} />
                      {r.domain}{r.team !== r.domain ? <span className="font-medium text-ink-500"> / {r.team}</span> : null}
                      <span className="mr-1 font-normal text-ink-400">({groupCounts.get(r.teamId) ?? 0})</span>
                    </button>
                  </td>
                </tr>
              );
              if (isCollapsed) return [headerRow];
              return [
                headerRow,
                <tr key={i.id} className={clsx("group hover:bg-brand-50/40", selected.has(i.id) && "bg-brand-50/60 [&>td]:!bg-brand-50")} data-item-row={i.id}
                  onClickCapture={(e) => onRowClick(e, r)} onContextMenu={(e) => onRowMenu(e, r)} style={{ height: 34 }}>
                  <td className={clsx(cell, "sticky z-10 truncate bg-white font-medium text-ink-700 group-hover:bg-[#f5f8ff]")} style={{ right: stickyRight("domain") }}>{r.domain}</td>
                  <td className={clsx(cell, "sticky z-10 truncate bg-white text-ink-700 group-hover:bg-[#f5f8ff]")} style={{ right: stickyRight("team") }}>{r.team}</td>
                  <td className={cell}><NameCell item={i} editable={r.editable} store={store} onOpen={() => ui.openItem(i.id)} /></td>
                  <td className={clsx(cell, "p-0")}>
                    <select disabled={!r.editable} value={i.priority} onChange={(e) => void store.updateItem(i, { priority: e.target.value })}
                      className={clsx("h-full w-full appearance-none bg-transparent px-2 py-2 outline-none", r.editable && "cursor-pointer hover:bg-ink-50")}
                      style={{ color: i.priority === cat.defaultPriority ? "#94a3b8" : cat.priority(i.priority).color, fontWeight: i.priority === cat.defaultPriority ? 400 : 600 }} aria-label="תיעדוף">
                      {cat.priorities.map((p) => <option key={p.key} value={p.key} style={{ color: "#0f172a" }}>{p.label}</option>)}
                      {!cat.priorities.some((p) => p.key === i.priority) && <option value={i.priority}>{cat.priority(i.priority).label}</option>}
                    </select>
                  </td>
                  <td className={clsx(cell, "px-1.5")}>
                    <select disabled={!r.editable} value={i.status} aria-label="סטטוס" data-testid={`status-${i.id}`}
                      onChange={(e) => {
                        const s = e.target.value;
                        void store.updateItem(i, { status: s }).then((ok) => {
                          if (ok && cat.status(s).noteRecommended && !i.notes.trim()) toast.show("info", "מומלץ להוסיף הסבר בשדה ההערות");
                        });
                      }}
                      className={clsx("h-6 w-full rounded-full border px-2 text-[12px] font-medium outline-none", r.editable ? "cursor-pointer" : "cursor-default")}
                      style={{ background: cat.status(i.status).bg, color: cat.status(i.status).fg, borderColor: cat.status(i.status).border }}>
                      {cat.statuses.map((s) => <option key={s.key} value={s.key} style={{ background: "#fff", color: "#0f172a" }}>{s.label}</option>)}
                      {!cat.statuses.some((s) => s.key === i.status) && <option value={i.status}>{cat.status(i.status).label}</option>}
                    </select>
                  </td>
                  <td className={cell}><NotesCell item={i} editable={r.editable} store={store} /></td>
                  <td className={cell}><WeekCell item={i} field="startWeek" editable={r.editable} store={store} /></td>
                  <td className={cell}><WeekCell item={i} field="endWeek" editable={r.editable} store={store} /></td>
                  <td className={clsx(cell, "truncate text-ink-500")}>{userName(data, i.createdById)}</td>
                  <td className={clsx(cell, "truncate text-ink-500")} title={`ע״י ${userName(data, i.updatedById)}`}>{fmtTs(i.updatedAt)}</td>
                  <td className={clsx(cell, "font-mono text-[11.5px] text-ink-500")}>
                    <button className="flex items-center gap-1 hover:text-brand-600" onClick={() => ui.openItem(i.id)} title="פתח פרטים">{i.id}<ExternalLink size={11} className="opacity-0 group-hover:opacity-100" /></button>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <Floating open={!!rowMenu} point={rowMenu ?? undefined} onClose={() => setRowMenu(null)}>
        {rowMenu && <RowMenu menu={rowMenu} store={store} onOpen={(id) => ui.openItem(id)} onDone={() => { setRowMenu(null); }} onDeleted={() => setSelected(new Set())} />}
      </Floating>
      <Floating open={!!groupMenu} point={groupMenu ?? undefined} onClose={() => setGroupMenu(null)}>
        {groupMenu && (
          <div className="w-[240px] p-1" onClick={() => setGroupMenu(null)} data-testid="group-menu">
            {setView && <LabelMenu label={{ domainId: groupMenu.domainId, teamId: data.teams.find((t) => t.id === groupMenu.teamId)?.name === data.domains.find((d) => d.id === groupMenu.domainId)?.name ? null : groupMenu.teamId }}
              data={data} view={view} setView={setView} toast={toast} />}
            <div className="my-1 border-t border-ink-100" />
            <MenuItem icon={<ChevronsDownUp size={14} />} onClick={() => setCollapsedSave(new Set(groupCounts.keys()))}>מזעור כל המקטעים</MenuItem>
            <MenuItem icon={<ChevronsUpDown size={14} />} onClick={() => setCollapsedSave(new Set())}>הצגת כל המקטעים</MenuItem>
          </div>
        )}
      </Floating>
    </div>
  );
});

/** תפריט קליק ימני על שורה (או על כמה שורות נבחרות): סטטוס, תיעדוף, פרטים, מחיקה */
function RowMenu({ menu, store, onOpen, onDone, onDeleted }: {
  menu: { items: ItemDTO[]; one: Row }; store: PlanStore; onOpen: (id: number) => void; onDone: () => void; onDeleted: () => void;
}) {
  const cat = useCatalog();
  const confirm = useConfirm();
  const { items, one } = menu;
  const multi = items.length > 1;
  const editable = multi || one.editable;
  const apply = (patch: { status?: string; priority?: string }) => {
    onDone();
    if (multi) void store.bulkUpdate(items, patch);
    else void store.updateItem(items[0], patch);
  };
  return (
    <div className="w-[250px] p-1" data-testid="row-menu">
      <div className="truncate px-2.5 pb-1 pt-1 text-[11px] font-semibold text-ink-500">{multi ? `${items.length} תכולות נבחרו` : one.item.name}</div>
      {!multi && <MenuItem icon={<ExternalLink size={14} />} onClick={() => { onDone(); onOpen(one.item.id); }}>פתח פרטי תכולה</MenuItem>}
      {editable ? (
        <>
          <div className="my-1 border-t border-ink-100" />
          <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold text-ink-400">שינוי סטטוס</div>
          <div className="grid grid-cols-2 gap-0.5 px-1">
            {cat.statuses.map((st) => (
              <button key={st.key} onClick={() => apply({ status: st.key })} data-status-option={st.key}
                className={clsx("flex items-center gap-1.5 rounded px-1.5 py-1 text-start text-[12px] hover:bg-ink-100", !multi && one.item.status === st.key && "bg-ink-100 font-semibold")}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm border" style={{ background: st.bg, borderColor: st.border }} />
                <span className="truncate">{st.label}</span>
              </button>
            ))}
          </div>
          <div className="my-1 border-t border-ink-100" />
          <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold text-ink-400">שינוי תיעדוף</div>
          <div className="flex flex-wrap gap-0.5 px-1">
            {cat.priorities.map((p) => (
              <button key={p.key} onClick={() => apply({ priority: p.key })} data-priority-option={p.key}
                className={clsx("rounded px-2 py-1 text-[12px] font-medium hover:bg-ink-100", !multi && one.item.priority === p.key && "bg-ink-100")}
                style={{ color: p.key === cat.defaultPriority ? "#64748b" : p.color }}>{p.label}</button>
            ))}
          </div>
          <div className="my-1 border-t border-ink-100" />
          <MenuItem danger icon={<Trash2 size={14} />} onClick={async () => {
            onDone();
            const ok = await confirm({
              title: multi ? `מחיקת ${items.length} תכולות` : "מחיקת תכולה", danger: true, confirm: "מחיקה",
              text: <>
                {multi ? `האם אתה בטוח שברצונך למחוק ${items.length} תכולות?` : <>האם אתה בטוח שברצונך למחוק את &quot;{one.item.name}&quot;?</>}
                <span className="mt-1.5 block text-[12px] text-ink-500">אם תרצה לשחזר, התכולה תהיה זמינה ב-{DELETED_RETENTION_DAYS} הימים הקרובים תחת &quot;תכולות שנמחקו&quot; (עם אותו ID).</span>
              </>,
            });
            if (!ok) return;
            for (const it of items) await store.deleteItem(it);
            onDeleted();
          }}>{multi ? `מחיקת ${items.length} תכולות` : "מחיקת תכולה"}</MenuItem>
        </>
      ) : <div className="px-2.5 py-1.5 text-[12px] text-ink-400">אין לך הרשאת עריכה לתחום זה — צפייה בלבד</div>}
    </div>
  );
}

function NameCell({ item, editable, store, onOpen }: { item: ItemDTO; editable: boolean; store: PlanStore; onOpen: () => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(item.name);
  if (edit) {
    return (
      <input autoFocus className="input h-7" value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEdit(false); if (v.trim() && v !== item.name) void store.updateItem(item, { name: v.trim() }); else setV(item.name); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(item.name); setEdit(false); } }} />
    );
  }
  return (
    <div className={clsx("truncate rounded px-1 -mx-1 py-0.5 font-medium text-ink-900", editable && "cursor-text hover:bg-ink-100")}
      onClick={() => { if (editable) { setV(item.name); setEdit(true); } else onOpen(); }} title={item.name}>
      {item.name}
    </div>
  );
}

function NotesCell({ item, editable, store }: { item: ItemDTO; editable: boolean; store: PlanStore }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(item.notes);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); if (v !== item.notes) void store.updateItem(item, { notes: v }); };
  const warn = useCatalog().status(item.status).noteRecommended && !item.notes.trim();
  return (
    <>
      <div ref={ref} className={clsx("truncate rounded px-1 -mx-1 py-0.5", editable && "cursor-text hover:bg-ink-100", !item.notes && "text-ink-300")}
        onClick={() => { if (editable) { setV(item.notes); setOpen(true); } }} title={item.notes}>
        {item.notes || (editable ? (warn ? <span className="text-amber-600">מומלץ להוסיף הסבר…</span> : "הוסף הערה…") : "—")}
      </div>
      <Floating anchor={ref.current} open={open} onClose={close}>
        <div className="w-[340px] p-2">
          <textarea autoFocus className="input min-h-[110px]" value={v} onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) close(); }} />
          <div className="mt-1.5 flex items-center gap-2">
            <button className="btn-primary btn-sm" onClick={close}>שמירה</button>
            <span className="text-[11px] text-ink-400"><span className="kbd">Ctrl</span>+<span className="kbd">Enter</span></span>
          </div>
        </div>
      </Floating>
    </>
  );
}

function WeekCell({ item, field, editable, store }: { item: ItemDTO; field: "startWeek" | "endWeek"; editable: boolean; store: PlanStore }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const v = item[field];
  return (
    <>
      <button ref={ref} disabled={!editable} onClick={() => setOpen(true)}
        className={clsx("w-full rounded px-1 -mx-1 py-0.5 text-start tabular-nums", editable && "hover:bg-ink-100")}
        title={`${fmtDate(v)}–${fmtDate(weekEndOf(v))}`}>
        שבוע {weekNumber(v)} <span className="text-ink-400">· {weekYear(v)}</span>
      </button>
      <Floating anchor={ref.current} open={open} onClose={() => setOpen(false)}>
        <div className="w-[300px] p-2.5">
          <div className="label">{field === "startWeek" ? "שבוע התחלה" : "שבוע סיום"}</div>
          <WeekPicker value={v} min={field === "endWeek" ? item.startWeek : undefined} onChange={(nv) => {
            const patch = field === "startWeek" ? (nv > item.endWeek ? { startWeek: nv, endWeek: nv } : { startWeek: nv }) : { endWeek: nv < item.startWeek ? item.startWeek : nv };
            void store.updateItem(item, patch);
            setOpen(false);
          }} />
        </div>
      </Floating>
    </>
  );
}
