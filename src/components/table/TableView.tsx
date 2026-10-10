"use client";
// תצוגת תכולות (Table View) — אותו מקור נתונים ואותן פעולות עדכון כמו הגאנט.
import { memo, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Layers, X } from "lucide-react";
import type { ItemDTO, Me, ViewConfig } from "@/lib/types";
import { STATUSES, STATUS_META, PRIORITIES, PRIORITY_META, NOTE_RECOMMENDED, type Status, type PriorityT } from "@/lib/constants";
import { fmtDate, weekEndOf, weekNumber, weekYear } from "@/lib/weeks";
import { Floating } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import type { PlanStore } from "@/components/plan/store";
import { useWorkspaceUI, placeLabel, userName, fmtTs } from "@/components/plan/ui";
import { itemMatches, timeWindow, visibleTeamIds } from "@/components/plan/filters";
import { WeekPicker } from "@/components/plan/WeekPicker";
import { currentPrefs, savePrefs } from "@/components/plan/prefs";

type ColKey = "domain" | "team" | "id" | "name" | "priority" | "status" | "notes" | "start" | "end" | "createdBy" | "updatedAt";
const COLS: { key: ColKey; label: string; w: number; sticky?: boolean }[] = [
  { key: "domain", label: "תחום", w: 110, sticky: true },
  { key: "team", label: "צוות", w: 130, sticky: true },
  { key: "id", label: "ID", w: 60 },
  { key: "name", label: "שם התכולה", w: 280 },
  { key: "priority", label: "תיעדוף", w: 100 },
  { key: "status", label: "סטטוס", w: 150 },
  { key: "notes", label: "הערות", w: 260 },
  { key: "start", label: "שבוע התחלה", w: 150 },
  { key: "end", label: "שבוע סיום", w: 150 },
  { key: "createdBy", label: "מי הזין", w: 130 },
  { key: "updatedAt", label: "עדכון אחרון", w: 150 },
];
const CHECK_W = 36;

type Row = { item: ItemDTO; domain: string; team: string; domainOrder: number; teamOrder: number; rowOrder: number; editable: boolean };

export const TableView = memo(function TableView({ store, view, me }: { store: PlanStore; view: ViewConfig; me: Me }) {
  const data = store.data!;
  const ui = useWorkspaceUI();
  const toast = useToast();
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
    const crossFilterActive = view.domainIds.length > 0 || view.teamIds.length > 0;
    return data.items
      .filter((i) => {
        const r = rMap.get(i.rowId);
        if (r?.kind === "TEAM") { if (!teamsVisible.has(i.teamId!)) return false; }
        else if (crossFilterActive) return false;
        return itemMatches(i, view, view.time.kind === "all" ? undefined : win);
      })
      .map((i) => {
        const p = placeLabel(data, i);
        const t = i.teamId ? tMap.get(i.teamId) : undefined;
        const r = rMap.get(i.rowId);
        return {
          item: i, domain: p.domain, team: p.team,
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
        case "priority": return PRIORITY_META[r.item.priority].rank;
        case "status": return STATUSES.indexOf(r.item.status);
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
  }, [rows, sort, data]);

  const groupedOn = grouped && (!sort || sort.key === "domain" || sort.key === "team");
  const selItems = sorted.filter((r) => selected.has(r.item.id) && r.editable).map((r) => r.item);
  const allSelected = sorted.length > 0 && sorted.filter((r) => r.editable).every((r) => selected.has(r.item.id));

  const toggleSort = (k: ColKey) => setSort((s) => (!s || s.key !== k ? { key: k, dir: 1 } : s.dir === 1 ? { key: k, dir: -1 } : null));

  const onResize = (k: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = widths[k];
    const move = (ev: MouseEvent) => setWidths((w) => ({ ...w, [k]: Math.max(50, Math.min(800, w0 + (x0 - ev.clientX))) }));
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
        <button className={clsx("btn-ghost btn-sm", grouped && "bg-ink-100")} onClick={() => setGrouped((g) => !g)}><Layers size={13} />קיבוץ לפי תחום וצוות</button>
        {sort && <button className="btn-ghost btn-sm" onClick={() => setSort(null)}><X size={12} />ביטול מיון</button>}
        {selItems.length > 0 && (
          <div className="mr-4 flex items-center gap-2 rounded-md bg-brand-50 px-2 py-1 text-brand-700" data-testid="bulk-bar">
            <span className="font-medium">{selItems.length} נבחרו</span>
            <select className="input h-7 w-auto py-0 text-[12px]" value="" onChange={async (e) => { if (e.target.value) { await store.bulkUpdate(selItems, { status: e.target.value as Status }); } }} data-testid="bulk-status">
              <option value="">שינוי סטטוס…</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            <select className="input h-7 w-auto py-0 text-[12px]" value="" onChange={async (e) => { if (e.target.value) { await store.bulkUpdate(selItems, { priority: e.target.value as PriorityT }); } }}>
              <option value="">שינוי תיעדוף…</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
            <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>ניקוי בחירה</button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="border-separate border-spacing-0 text-[12.5px]" style={{ width: totalW, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: CHECK_W }} />
            {COLS.map((c) => <col key={c.key} style={{ width: widths[c.key] }} />)}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky right-0 z-30 border-b border-l border-ink-200 bg-[var(--header)]" style={{ height: 34 }}>
                <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={allSelected} aria-label="בחר הכל"
                  onChange={(e) => setSelected(e.target.checked ? new Set(sorted.filter((r) => r.editable).map((r) => r.item.id)) : new Set())} />
              </th>
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
              <tr><td colSpan={COLS.length + 1} className="p-12 text-center text-ink-500">אין תכולות להצגה לפי הסינון הנוכחי</td></tr>
            )}
            {sorted.map((r) => {
              const g = `${r.domain} / ${r.team}`;
              const header = groupedOn && g !== lastGroup;
              lastGroup = g;
              const i = r.item;
              const cell = "border-b border-l border-ink-100 px-2 align-middle";
              return [
                header && (
                  <tr key={`g-${g}`}>
                    <td colSpan={COLS.length + 1} className="border-b border-ink-200 bg-ink-50 p-0">
                      <div className="sticky right-0 inline-block px-3 py-1.5 text-[12px] font-bold text-ink-700">
                        {r.domain}{r.team !== r.domain ? <span className="font-medium text-ink-500"> / {r.team}</span> : null}
                        <span className="mr-2 font-normal text-ink-400">({sorted.filter((x) => `${x.domain} / ${x.team}` === g).length})</span>
                      </div>
                    </td>
                  </tr>
                ),
                <tr key={i.id} className={clsx("group hover:bg-brand-50/40", selected.has(i.id) && "bg-brand-50/60")} data-item-row={i.id}>
                  <td className={clsx(cell, "sticky right-0 z-10 bg-white text-center group-hover:bg-[#f5f8ff]")} style={{ height: 34 }}>
                    <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" disabled={!r.editable} checked={selected.has(i.id)} aria-label={`בחר ${i.name}`}
                      onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />
                  </td>
                  <td className={clsx(cell, "sticky z-10 truncate bg-white font-medium text-ink-700 group-hover:bg-[#f5f8ff]")} style={{ right: stickyRight("domain") }}>{r.domain}</td>
                  <td className={clsx(cell, "sticky z-10 truncate bg-white text-ink-700 group-hover:bg-[#f5f8ff]")} style={{ right: stickyRight("team") }}>{r.team}</td>
                  <td className={clsx(cell, "font-mono text-[11.5px] text-ink-500")}>
                    <button className="flex items-center gap-1 hover:text-brand-600" onClick={() => ui.openItem(i.id)} title="פתח פרטים">{i.id}<ExternalLink size={11} className="opacity-0 group-hover:opacity-100" /></button>
                  </td>
                  <td className={cell}><NameCell item={i} editable={r.editable} store={store} onOpen={() => ui.openItem(i.id)} /></td>
                  <td className={clsx(cell, "p-0")}>
                    <select disabled={!r.editable} value={i.priority} onChange={(e) => void store.updateItem(i, { priority: e.target.value as PriorityT })}
                      className={clsx("h-full w-full appearance-none bg-transparent px-2 py-2 outline-none", r.editable && "cursor-pointer hover:bg-ink-50")}
                      style={{ color: i.priority === "NONE" ? "#94a3b8" : PRIORITY_META[i.priority].color, fontWeight: i.priority === "NONE" ? 400 : 600 }} aria-label="תיעדוף">
                      {PRIORITIES.map((p) => <option key={p} value={p} style={{ color: "#0f172a" }}>{PRIORITY_META[p].label}</option>)}
                    </select>
                  </td>
                  <td className={clsx(cell, "px-1.5")}>
                    <select disabled={!r.editable} value={i.status} aria-label="סטטוס" data-testid={`status-${i.id}`}
                      onChange={(e) => {
                        const s = e.target.value as Status;
                        void store.updateItem(i, { status: s }).then((ok) => {
                          if (ok && NOTE_RECOMMENDED.includes(s) && !i.notes.trim()) toast.show("info", "מומלץ להוסיף הסבר בשדה ההערות");
                        });
                      }}
                      className={clsx("h-6 w-full rounded-full border px-2 text-[12px] font-medium outline-none", r.editable ? "cursor-pointer" : "cursor-default")}
                      style={{ background: STATUS_META[i.status].bg, color: STATUS_META[i.status].fg, borderColor: STATUS_META[i.status].border }}>
                      {STATUSES.map((s) => <option key={s} value={s} style={{ background: "#fff", color: "#0f172a" }}>{STATUS_META[s].label}</option>)}
                    </select>
                  </td>
                  <td className={cell}><NotesCell item={i} editable={r.editable} store={store} /></td>
                  <td className={cell}><WeekCell item={i} field="startWeek" editable={r.editable} store={store} /></td>
                  <td className={cell}><WeekCell item={i} field="endWeek" editable={r.editable} store={store} /></td>
                  <td className={clsx(cell, "truncate text-ink-500")}>{userName(data, i.createdById)}</td>
                  <td className={clsx(cell, "truncate text-ink-500")} title={`ע״י ${userName(data, i.updatedById)}`}>{fmtTs(i.updatedAt)}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

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
  const warn = NOTE_RECOMMENDED.includes(item.status) && !item.notes.trim();
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
