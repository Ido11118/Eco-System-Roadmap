"use client";
// מצב גאנט רגיל: שורות עבודה אמיתיות, יצירת תכולה בסימון טווח, גרירה/שינוי אורך, תפריטי הקשר.
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Plus, MoreVertical, Trash2, ArrowUpToLine, ArrowDownToLine, Diamond, Flag, ExternalLink, PanelTopOpen,
} from "lucide-react";
import type { ItemDTO, MilestoneDTO, PlanData, RowDTO, SprintDTO, ViewConfig } from "@/lib/types";
import { STATUS_META, STATUSES, CROSS_ROW_LABELS, PRIORITY_META } from "@/lib/constants";
import {
  buildTimeline, dayOfWeek, fmtDate, weekEndOf, weekRangeLabel, weekNumber, weekStartOf, daysDiff,
  type ISODate, type Timeline,
} from "@/lib/weeks";
import { layoutLanes } from "@/lib/compare";
import { useTooltip } from "@/components/ui/tooltip";
import { Floating, MenuItem } from "@/components/ui/popover";
import { useConfirm } from "@/components/ui/dialog";
import { findOverlap, type PlanStore } from "@/components/plan/store";
import { useWorkspaceUI, userName } from "@/components/plan/ui";
import { hasContentFilter, itemMatches, timeWindow, visibleTeamIds } from "@/components/plan/filters";
import { GanttGrid, useCurrentWeek, type CrossGroup, type GanttGridHandle, type LaneSpec } from "./GanttGrid";
import { geometry, SPRINT_LANE_H } from "./geometry";

type DragState = {
  item: ItemDTO;
  mode: "move" | "start" | "end";
  originX: number;
  originY: number;
  started: boolean;
  dWeeks: number;
  targetRowId: number;
  valid: boolean;
  reason?: string;
};
type SelState = { rowId: number; laneKey: string; teamId: number | null; a: number; b: number; min: number; max: number };
type QuickState = { rowId: number; laneKey: string; start: ISODate; end: ISODate; x: number; y: number };
type MenuState = { x: number; y: number; lane?: LaneSpec; teamId: number | null; week?: ISODate; item?: ItemDTO };

export type GanttHandle = { goToday: () => void };

export const GanttView = memo(forwardRef<GanttHandle, { store: PlanStore; view: ViewConfig }>(function GanttView({ store, view }, ref) {
  const data = store.data!;
  const ui = useWorkspaceUI();
  const tip = useTooltip();
  const confirm = useConfirm();
  const gridRef = useRef<GanttGridHandle>(null);
  const { weekW, rowH, crossLaneH } = geometry(view.density);

  const [win0, win1] = timeWindow(view.time, data);
  const timeline: Timeline = useMemo(() => buildTimeline(win0, win1), [win0, win1]);
  const cw = useCurrentWeek();
  const todayIndex = timeline.indexOf(cw);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [sel, setSel] = useState<SelState | null>(null);
  const [quick, setQuick] = useState<QuickState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  // הנתונים העדכניים (כולל רענון שהגיע באמצע גרירה) — הגרירה בודקת חפיפות מולם ולא מול הנתונים מתחילת הגרירה
  const liveRef = useRef({ data, store });
  liveRef.current = { data, store };

  useImperativeHandle(ref, () => ({ goToday: () => gridRef.current?.scrollToIndex(Math.max(0, todayIndex)) }), [todayIndex]);
  // גלילה ראשונית לשבוע הנוכחי ובכל שינוי של חלון הזמן
  useLayoutEffect(() => {
    gridRef.current?.scrollToIndex(todayIndex >= 0 ? todayIndex : 0, false);
  }, [win0, win1, weekW]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- סינון ומבנה ----------
  const teamsVisible = useMemo(() => visibleTeamIds(data, view), [data, view]);
  const filtering = hasContentFilter(view);
  const matches = useCallback((i: ItemDTO) => itemMatches(i, view), [view]);
  const rowsByTeam = useMemo(() => {
    const m = new Map<number, RowDTO[]>();
    for (const r of data.rows) if (r.kind === "TEAM" && r.teamId !== null) {
      if (!m.has(r.teamId)) m.set(r.teamId, []);
      m.get(r.teamId)!.push(r);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    return m;
  }, [data.rows]);
  const itemsByRow = useMemo(() => {
    const m = new Map<number, ItemDTO[]>();
    for (const i of data.items) {
      if (!m.has(i.rowId)) m.set(i.rowId, []);
      m.get(i.rowId)!.push(i);
    }
    return m;
  }, [data.items]);

  const teamLanes = useMemo(() => {
    const m = new Map<number, LaneSpec[]>();
    for (const t of data.teams) {
      const rows = rowsByTeam.get(t.id) ?? [];
      const ed = store.canEditTeam(t.id);
      m.set(t.id, rows.map((r, i) => ({ key: `r${r.id}`, rowId: r.id, height: rowH, isRowStart: true, rowIndex: i, editable: ed })));
    }
    return m;
  }, [data.teams, rowsByTeam, rowH, store]);

  // שורות רוחביות: חפיפה מותרת → פריסה לנתיבים
  const crossLayout = useMemo(() => {
    const groups: CrossGroup[] = [];
    const laneItems = new Map<string, ItemDTO[]>();
    for (const kind of ["INFLUENCE", "CROSS_EVENT"] as const) {
      const rows = data.rows.filter((r) => r.kind === kind);
      const items = data.items.filter((i) => rows.some((r) => r.id === i.rowId));
      const lanes = layoutLanes(items, rows.map((r) => r.id), (i) => i.rowId,
        (i) => [[timeline.indexOf(i.startWeek), timeline.indexOf(i.endWeek)]], (i) => i.id);
      const ed = store.canEditCross();
      groups.push({
        kind, label: CROSS_ROW_LABELS[kind], editable: ed,
        lanes: lanes.map((l, idx) => {
          const key = `${kind}-${l.rowId}-${l.laneIndex}`;
          laneItems.set(key, l.units);
          return { key, rowId: l.rowId, height: crossLaneH, isRowStart: l.laneIndex === 0, rowIndex: idx, virtual: l.laneIndex > 0, editable: ed };
        }),
      });
    }
    return { groups, laneItems };
  }, [data.rows, data.items, timeline, crossLaneH, store]);

  const teams = useMemo(() => data.teams.filter((t) => teamsVisible.has(t.id)), [data.teams, teamsVisible]);

  // ---------- גאומטריה ----------
  const idxOf = useCallback((s: ISODate) => timeline.indexOf(s), [timeline]);
  const n = timeline.weeks.length;
  const barBox = useCallback((start: ISODate, end: ISODate) => {
    const a = idxOf(start), b = idxOf(end);
    if (b < 0 || a >= n) return null;
    const ca = Math.max(0, a), cb = Math.min(n - 1, b);
    return { right: ca * weekW + 2, width: (cb - ca + 1) * weekW - 4, cutStart: a < 0, cutEnd: b > n - 1 };
  }, [idxOf, n, weekW]);

  // ---------- גרירה ----------
  const computeDrag = useCallback((d: DragState, clientX: number, clientY: number): DragState => {
    const { data, store } = liveRef.current;
    const dx = d.originX - clientX; // RTL: גרירה שמאלה = מאוחר יותר
    const started = d.started || Math.abs(dx) > 4 || Math.abs(clientY - d.originY) > 4;
    let dWeeks = Math.round(dx / weekW);
    let targetRowId = d.item.rowId;
    const origRow = data.rows.find((r) => r.id === d.item.rowId);
    if (d.mode === "move" && origRow?.kind === "TEAM") {
      const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-lane-row]");
      const rid = Number(el?.dataset.laneRow);
      const r = data.rows.find((x) => x.id === rid);
      if (r && r.kind === "TEAM") targetRowId = rid;
    }
    if (d.mode === "start") dWeeks = Math.min(dWeeks, Math.round(daysDiff(d.item.startWeek, d.item.endWeek) / 7));
    if (d.mode === "end") dWeeks = Math.max(dWeeks, -Math.round(daysDiff(d.item.startWeek, d.item.endWeek) / 7));
    const { start, end } = dragRange(d.item, d.mode, dWeeks);
    let valid = true, reason: string | undefined;
    const target = data.rows.find((r) => r.id === targetRowId);
    if (!store.canEditRow(target)) { valid = false; reason = "אין הרשאת עריכה לשורה זו"; }
    else {
      const clash = findOverlap(data, targetRowId, start, end, d.item.id);
      if (clash) { valid = false; reason = `חופף ל"${clash.name}"`; }
    }
    return { ...d, started, dWeeks, targetRowId, valid, reason };
  }, [weekW]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => setDrag((d) => (d ? computeDrag(d, e.clientX, e.clientY) : d));
    const onUp = (e: MouseEvent) => {
      const d0 = dragRef.current;
      setDrag(null);
      if (!d0) return;
      const d = computeDrag(d0, e.clientX, e.clientY);
      if (!d.started) { ui.openItem(d.item.id); return; }
      if (!d.valid || (d.dWeeks === 0 && d.targetRowId === d.item.rowId)) return;
      const { start, end } = dragRange(d.item, d.mode, d.dWeeks);
      const patch: Parameters<PlanStore["updateItem"]>[1] = {};
      if (start !== d.item.startWeek) patch.startWeek = start;
      if (end !== d.item.endWeek) patch.endWeek = end;
      if (d.targetRowId !== d.item.rowId) patch.rowId = d.targetRowId;
      void liveRef.current.store.updateItem(d.item, patch, { undoLabel: d.mode === "move" ? `"${d.item.name}" הוזזה` : `משך "${d.item.name}" עודכן` });
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrag(null); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    document.body.style.cursor = drag.mode === "move" ? "grabbing" : "ew-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- סימון טווח ליצירת תכולה ----------
  const selRef = useRef<SelState | null>(null);
  selRef.current = sel;
  const onLaneMouseDown = useCallback((e: React.MouseEvent, lane: LaneSpec, teamId: number | null, wi: number) => {
    if ((e.target as HTMLElement).closest("[data-bar],[data-marker]")) return;
    if (!lane.editable || wi < 0 || wi >= n) return;
    (document.activeElement as HTMLElement | null)?.blur?.(); // שומר עריכה פתוחה בחלונית לפני הפעולה
    e.preventDefault();
    setQuick(null);
    // גבולות: לא לחצות תכולה קיימת באותה שורה (בשורות צוות)
    const row = data.rows.find((r) => r.id === lane.rowId);
    let min = 0, max = n - 1;
    if (row?.kind === "TEAM") {
      for (const it of itemsByRow.get(lane.rowId) ?? []) {
        const a = idxOf(it.startWeek), b = idxOf(it.endWeek);
        if (a <= wi && b >= wi) return; // לחיצה על תא תפוס
        if (b < wi) min = Math.max(min, b + 1);
        if (a > wi) max = Math.min(max, a - 1);
      }
    }
    const el = e.currentTarget as HTMLElement;
    setSel({ rowId: lane.rowId, laneKey: lane.key, teamId, a: wi, b: wi, min, max });
    const onMove = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const w = Math.floor((r.right - ev.clientX) / weekW);
      setSel((s) => (s ? { ...s, b: Math.max(s.min, Math.min(s.max, w)) } : s));
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const s = selRef.current;
      setSel(null);
      if (!s) return;
      const lo = Math.min(s.a, s.b), hi = Math.max(s.a, s.b);
      setQuick({ rowId: s.rowId, laneKey: s.laneKey, start: timeline.weeks[lo].start, end: timeline.weeks[hi].start, x: ev.clientX, y: ev.clientY });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [data.rows, itemsByRow, idxOf, n, timeline, weekW]);

  const onLaneContextMenu = useCallback((e: React.MouseEvent, lane: LaneSpec, teamId: number | null, wi: number) => {
    const barEl = (e.target as HTMLElement).closest<HTMLElement>("[data-bar]");
    const item = barEl ? data.items.find((i) => i.id === Number(barEl.dataset.bar)) : undefined;
    setMenu({ x: e.clientX, y: e.clientY, lane, teamId, week: wi >= 0 && wi < n ? timeline.weeks[wi].start : undefined, item });
  }, [data.items, n, timeline]);

  // ---------- רינדור קוביות ----------
  const startDrag = (e: React.MouseEvent, item: ItemDTO, mode: DragState["mode"], editable: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (document.activeElement as HTMLElement | null)?.blur?.();
    e.preventDefault();
    if (!editable) { ui.openItem(item.id); return; }
    tip.hide();
    setDrag({ item, mode, originX: e.clientX, originY: e.clientY, started: false, dWeeks: 0, targetRowId: item.rowId, valid: true });
  };

  const itemTip = (i: ItemDTO) => (
    <div className="space-y-0.5">
      <div className="font-semibold">{i.name}</div>
      <div className="opacity-80">ID {i.id} · {STATUS_META[i.status].label}{i.priority !== "NONE" ? ` · תיעדוף ${PRIORITY_META[i.priority].label}` : ""}</div>
      <div className="opacity-80">שבועות {weekNumber(i.startWeek)}–{weekNumber(i.endWeek)} · {fmtDate(i.startWeek)}–{fmtDate(weekEndOf(i.endWeek))}</div>
      {i.notes && <div className="max-w-[300px] truncate opacity-70">{i.notes}</div>}
      <div className="opacity-60">עודכן ע״י {userName(data, i.updatedById)}</div>
    </div>
  );

  const renderBar = (i: ItemDTO, editable: boolean, height: number, opts?: { ghost?: boolean; start?: ISODate; end?: ISODate; invalid?: boolean }) => {
    const box = barBox(opts?.start ?? i.startWeek, opts?.end ?? i.endWeek);
    if (!box) return null;
    const m = STATUS_META[i.status];
    const dim = filtering && !matches(i);
    const isDragged = drag?.started && drag.item.id === i.id && !opts?.ghost;
    const selected = ui.selectedItemId === i.id;
    return (
      <div key={opts?.ghost ? `g${i.id}` : i.id}
        data-bar={opts?.ghost ? undefined : i.id}
        className={clsx("gantt-bar group/bar absolute z-10 flex items-center overflow-hidden rounded-[5px] border text-[12px] font-medium",
          editable ? "cursor-grab" : "cursor-pointer",
          opts?.ghost && "pointer-events-none !z-30 shadow-pop",
          opts?.invalid && "!border-red-500 !bg-red-100 !text-red-700 ring-2 ring-red-300",
          isDragged && "opacity-30",
          dim && "opacity-25",
          selected && "ring-2 ring-brand-500 ring-offset-1",
          box.cutStart && "rounded-r-none border-r-dashed",
          box.cutEnd && "rounded-l-none")}
        style={{ right: box.right, width: box.width, top: 3, height: height - 6, background: m.bg, color: m.fg, borderColor: m.border }}
        onMouseDown={(e) => startDrag(e, i, "move", editable)}
        onMouseMove={(e) => { if (!drag) tip.show(itemTip(i), e); }}
        onMouseLeave={tip.hide}
        onDoubleClick={() => ui.openItem(i.id)}
        role={opts?.ghost ? undefined : "button"} tabIndex={opts?.ghost ? undefined : 0}
        aria-label={opts?.ghost ? undefined : `${i.name}, ${STATUS_META[i.status].label}, שבועות ${weekNumber(i.startWeek)}–${weekNumber(i.endWeek)}`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ui.openItem(i.id); } }}>
        {/* ידיות שינוי אורך — לא בקצה שנחתך ע"י חלון הזמן (הקצה האמיתי מחוץ לתצוגה) */}
        {editable && !opts?.ghost && !box.cutStart && (
          <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 bg-black/10" onMouseDown={(e) => startDrag(e, i, "start", true)} />
        )}
        {editable && !opts?.ghost && !box.cutEnd && (
          <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 bg-black/10" onMouseDown={(e) => startDrag(e, i, "end", true)} />
        )}
        <span className="truncate px-1.5">{i.name}</span>
      </div>
    );
  };

  const renderLane = (lane: LaneSpec, teamId: number | null) => {
    const row = data.rows.find((r) => r.id === lane.rowId);
    const items = teamId === null ? crossLayout.laneItems.get(lane.key) ?? [] : itemsByRow.get(lane.rowId) ?? [];
    const editable = lane.editable;
    const out: React.ReactNode[] = items.map((i) => renderBar(i, editable && store.canEditRow(row), lane.height));
    if (sel && sel.laneKey === lane.key) {
      const lo = Math.min(sel.a, sel.b), hi = Math.max(sel.a, sel.b);
      out.push(<div key="sel" className="select-range pointer-events-none absolute z-20 rounded" style={{ right: lo * weekW + 1, width: (hi - lo + 1) * weekW - 2, top: 3, height: lane.height - 6 }} />);
    }
    if (quick && quick.laneKey === lane.key) {
      const lo = idxOf(quick.start), hi = idxOf(quick.end);
      out.push(<div key="q" className="select-range pointer-events-none absolute z-20 rounded" style={{ right: lo * weekW + 1, width: (hi - lo + 1) * weekW - 2, top: 3, height: lane.height - 6 }} />);
    }
    const ghostHere = drag?.started && drag.targetRowId === lane.rowId &&
      (teamId === null ? (crossLayout.laneItems.get(lane.key) ?? []).some((i) => i.id === drag.item.id) : lane.isRowStart);
    if (drag?.started && ghostHere) {
      const { start, end } = dragRange(drag.item, drag.mode, drag.dWeeks);
      out.push(renderBar(drag.item, true, lane.height, { ghost: true, start, end, invalid: !drag.valid }));
    }
    // אבני דרך רוחביות בשורת "מופעים רוחביים"
    if (teamId === null && view.showMilestones && row?.kind === "CROSS_EVENT" && lane.isRowStart && lane.rowIndex === 0) {
      for (const m of data.milestones.filter((x) => x.teamId === null)) out.push(renderMilestone(m, lane.height));
    }
    return out;
  };

  const dateX = (d: ISODate) => idxOf(weekStartOf(d)) * weekW + (dayOfWeek(d) + 0.5) * (weekW / 7);

  const renderMilestone = (m: MilestoneDTO, h: number) => {
    const wi = idxOf(weekStartOf(m.date));
    if (wi < 0 || wi >= n) return null;
    return (
      <button key={`m${m.id}`} data-marker="milestone" className="pointer-events-auto absolute z-[25] -translate-y-1/2 translate-x-1/2"
        style={{ right: dateX(m.date), top: h / 2 }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => ui.openMilestone(m)}
        onMouseMove={(e) => tip.show(<div><div className="font-semibold">◆ {m.name}</div><div className="opacity-80">{fmtDate(m.date)}{m.teamId === null ? " · רוחבי" : ""}</div>{m.notes && <div className="opacity-70">{m.notes}</div>}</div>, e)}
        onMouseLeave={tip.hide} aria-label={`אבן דרך: ${m.name}`}>
        <span className="block h-3 w-3 rotate-45 rounded-[2px] border-2 border-white bg-violet-600 shadow" />
      </button>
    );
  };

  const msByTeam = useMemo(() => {
    const m = new Map<number, MilestoneDTO[]>();
    for (const x of data.milestones) if (x.teamId !== null) {
      if (!m.has(x.teamId)) m.set(x.teamId, []);
      m.get(x.teamId)!.push(x);
    }
    return m;
  }, [data.milestones]);

  const renderTeamOverlay = view.showMilestones ? (teamId: number, height: number) => (
    <>
      {(msByTeam.get(teamId) ?? []).map((m) => {
        const wi = idxOf(weekStartOf(m.date));
        if (wi < 0 || wi >= n) return null;
        return (
          <div key={m.id}>
            <div className="absolute w-0 border-r border-dashed border-violet-400/70" style={{ right: dateX(m.date), top: 0, height }} />
            {renderMilestone(m, 10)}
          </div>
        );
      })}
    </>
  ) : undefined;

  const renderBodyOverlay = view.showMilestones ? () => (
    <>
      {data.milestones.filter((m) => m.teamId === null).map((m) => {
        const wi = idxOf(weekStartOf(m.date));
        if (wi < 0 || wi >= n) return null;
        return <div key={m.id} className="absolute inset-y-0 w-0 border-r border-dotted border-violet-300" style={{ right: dateX(m.date) }} />;
      })}
    </>
  ) : undefined;

  const sprintsByTeam = useMemo(() => {
    const m = new Map<number, SprintDTO[]>();
    for (const s of data.sprints) {
      if (!m.has(s.teamId)) m.set(s.teamId, []);
      m.get(s.teamId)!.push(s);
    }
    return m;
  }, [data.sprints]);

  const teamFooter = view.showSprints ? (teamId: number) => {
    const list = sprintsByTeam.get(teamId) ?? [];
    const lanes = layoutLanes(list, [0], () => 0, (s) => [[idxOf(weekStartOf(s.startDate)), idxOf(weekStartOf(s.endDate))]], (s) => s.id);
    const h = Math.max(1, lanes.length) * SPRINT_LANE_H + 2;
    return {
      height: h,
      node: (
        <>
          {lanes.flatMap((l) => l.units.map((s) => {
            const x0 = dateX(s.startDate) - (weekW / 7) / 2, x1 = dateX(s.endDate) + (weekW / 7) / 2;
            if (x1 < 0 || x0 > n * weekW) return null;
            return (
              <button key={s.id} className="absolute flex items-center overflow-hidden rounded-sm border border-teal-300 bg-teal-50 px-1 text-[10px] font-medium text-teal-800 hover:bg-teal-100"
                style={{ right: Math.max(0, x0), width: Math.max(8, x1 - Math.max(0, x0)), top: 1 + l.laneIndex * SPRINT_LANE_H, height: SPRINT_LANE_H - 2 }}
                onClick={() => ui.openSprint(s)}
                onMouseMove={(e) => tip.show(<div><div className="font-semibold">{s.name}</div><div className="opacity-80">{fmtDate(s.startDate)} – {fmtDate(s.endDate)}</div></div>, e)}
                onMouseLeave={tip.hide}>
                <span className="truncate">{s.name}</span>
              </button>
            );
          }))}
        </>
      ),
    };
  } : undefined;

  const rowMenu = (lane: LaneSpec, teamId: number, x: number, y: number) => setMenu({ x, y, lane, teamId });

  const renderRowControl = (lane: LaneSpec, teamId: number) => lane.editable ? (
    <button className="flex h-full w-full items-center justify-center text-ink-300 opacity-0 transition hover:bg-ink-100 hover:text-ink-700 group-hover/row:opacity-100"
      onClick={(e) => rowMenu(lane, teamId, e.clientX, e.clientY)} aria-label="פעולות שורה" data-testid={`row-menu-${lane.rowId}`}>
      <MoreVertical size={13} />
    </button>
  ) : null;

  const teamLabelExtra = (teamId: number) => store.canEditTeam(teamId) ? (
    <button className="icon-btn h-5 w-5 opacity-0 group-hover/team:opacity-100" title="הוסף שורה בסוף הצוות"
      onClick={() => void store.createRow(teamId)} data-testid={`add-row-${teamId}`}><Plus size={13} /></button>
  ) : null;

  const deleteRow = async (rowId: number) => {
    const row = data.rows.find((r) => r.id === rowId);
    if (!row) return;
    const items = itemsByRow.get(rowId) ?? [];
    if (items.length) {
      const ok = await confirm({
        title: "מחיקת שורה", danger: true, confirm: "מחיקת שורה",
        text: <>שים לב, בשורה זו קיים תוכן. האם אתה בטוח שברצונך למחוק את השורה?<br /><span className="text-ink-500">המחיקה תכלול גם את {items.length} התכולות המשויכות לשורה.</span></>,
      });
      if (!ok) return;
    }
    await store.deleteRow(row);
  };

  return (
    <div className="relative h-full" data-testid="gantt-view">
      <GanttGrid ref={gridRef} timeline={timeline} weekW={weekW} domains={data.domains} teams={teams}
        teamLanes={teamLanes} crossGroups={crossLayout.groups} todayIndex={todayIndex}
        renderLane={renderLane} renderTeamOverlay={renderTeamOverlay} renderBodyOverlay={renderBodyOverlay}
        teamFooter={teamFooter} renderRowControl={renderRowControl} teamLabelExtra={teamLabelExtra}
        teamEditable={(t) => store.canEditTeam(t)}
        onLaneMouseDown={store.readOnly ? undefined : onLaneMouseDown} onLaneContextMenu={onLaneContextMenu} />

      {drag?.started && !drag.valid && drag.reason && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md bg-red-600 px-3 py-1.5 text-[12px] text-white shadow-pop">{drag.reason}</div>
      )}
      {drag?.started && drag.valid && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md bg-ink-900 px-3 py-1.5 text-[12px] text-white shadow-pop tabular-nums">
          {(() => { const r = dragRange(drag.item, drag.mode, drag.dWeeks); return `שבועות ${weekNumber(r.start)}–${weekNumber(r.end)} · ${weekRangeLabel(r.start).split("–")[0]} – ${fmtDate(weekEndOf(r.end))}`; })()}
        </div>
      )}

      {quick && <QuickCreate quick={quick} store={store} onClose={() => setQuick(null)}
        onMore={(name) => { const q = quick; setQuick(null); ui.openNewItem({ rowId: q.rowId, startWeek: q.start, endWeek: q.end, name }); }} />}

      <Floating open={!!menu} point={menu ? { x: menu.x, y: menu.y } : undefined} onClose={() => setMenu(null)}>
        {menu && (
          <div className="w-[230px] p-1" onClick={() => setMenu(null)}>
            {menu.item ? (
              <>
                <MenuItem icon={<ExternalLink size={14} />} onClick={() => ui.openItem(menu.item!.id)}>פתח פרטי תכולה</MenuItem>
                {store.canEditRow(data.rows.find((r) => r.id === menu.item!.rowId)) && (
                  <>
                    <div className="my-1 border-t border-ink-100" />
                    <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold text-ink-400">שינוי סטטוס</div>
                    <div className="grid grid-cols-2 gap-0.5 px-1">
                      {STATUSES.map((s) => (
                        <button key={s} onClick={() => void store.updateItem(menu.item!, { status: s })}
                          className={clsx("flex items-center gap-1.5 rounded px-1.5 py-1 text-start text-[12px] hover:bg-ink-100", menu.item!.status === s && "bg-ink-100 font-semibold")}>
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm border" style={{ background: STATUS_META[s].bg, borderColor: STATUS_META[s].border }} />
                          <span className="truncate">{STATUS_META[s].label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="my-1 border-t border-ink-100" />
                    <MenuItem danger icon={<Trash2 size={14} />} onClick={async () => {
                      if (await confirm({ title: "מחיקת תכולה", text: `למחוק את "${menu.item!.name}"?`, confirm: "מחיקה", danger: true })) await store.deleteItem(menu.item!);
                    }}>מחיקת תכולה</MenuItem>
                  </>
                )}
              </>
            ) : (
              <>
                {menu.lane?.editable && menu.week && (
                  <MenuItem icon={<PanelTopOpen size={14} />} onClick={() => ui.openNewItem({ rowId: menu.lane!.rowId, startWeek: menu.week, endWeek: menu.week })}>הוסף תכולה בשבוע {weekNumber(menu.week)}</MenuItem>
                )}
                {menu.week && (menu.teamId === null ? store.canEditCross() : store.canEditTeam(menu.teamId)) && view.showMilestones && (
                  <MenuItem icon={<Diamond size={14} />} onClick={() => ui.openMilestone(null, { teamId: menu.teamId, date: menu.week })}>הוסף אבן דרך כאן</MenuItem>
                )}
                {menu.teamId !== null && store.canEditTeam(menu.teamId) && (
                  <MenuItem icon={<Flag size={14} />} onClick={() => ui.openSprint(null, { teamId: menu.teamId!, startDate: menu.week })}>הוסף ספרינט</MenuItem>
                )}
                {menu.teamId !== null && menu.lane?.editable && (
                  <>
                    <div className="my-1 border-t border-ink-100" />
                    <MenuItem icon={<ArrowUpToLine size={14} />} onClick={() => void store.createRow(menu.teamId!, menu.lane!.rowId, "above")}>הוסף שורה מעל</MenuItem>
                    <MenuItem icon={<ArrowDownToLine size={14} />} onClick={() => void store.createRow(menu.teamId!, menu.lane!.rowId, "below")}>הוסף שורה מתחת</MenuItem>
                    <MenuItem danger icon={<Trash2 size={14} />} onClick={() => void deleteRow(menu.lane!.rowId)}>מחיקת שורה</MenuItem>
                  </>
                )}
                {!menu.lane?.editable && <div className="px-2.5 py-1.5 text-[12px] text-ink-400">אין הרשאת עריכה לאזור זה</div>}
              </>
            )}
          </div>
        )}
      </Floating>
    </div>
  );
}));

export function dragRange(item: ItemDTO, mode: DragState["mode"], d: number): { start: ISODate; end: ISODate } {
  const add = (s: ISODate, w: number) => {
    const t = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + w * 7));
    return t.toISOString().slice(0, 10);
  };
  if (mode === "move") return { start: add(item.startWeek, d), end: add(item.endWeek, d) };
  if (mode === "start") return { start: add(item.startWeek, d), end: item.endWeek };
  return { start: item.startWeek, end: add(item.endWeek, d) };
}

function QuickCreate({ quick, store, onClose, onMore }: { quick: QuickState; store: PlanStore; onClose: () => void; onMore: (name: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const it = await store.createItem({ rowId: quick.rowId, name: name.trim(), startWeek: quick.start, endWeek: quick.end });
    setBusy(false);
    if (it) onClose();
  };
  return (
    <Floating open point={{ x: quick.x, y: quick.y }} onClose={onClose}>
      <div className="w-[300px] p-3" data-testid="quick-create">
        <div className="mb-2 text-[12px] text-ink-500">
          תכולה חדשה · שבועות {weekNumber(quick.start)}–{weekNumber(quick.end)} ({fmtDate(quick.start)} – {fmtDate(weekEndOf(quick.end))})
        </div>
        <input className="input" autoFocus placeholder="שם התכולה ואז Enter" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onClose(); }} data-testid="quick-name" />
        <div className="mt-2.5 flex items-center gap-2">
          <button className="btn-primary btn-sm" disabled={!name.trim() || busy} onClick={() => void submit()}>הוספה</button>
          <button className="btn-ghost btn-sm" onClick={() => onMore(name)}>פרטים נוספים…</button>
          <span className="mr-auto text-[11px] text-ink-400"><span className="kbd">Enter</span></span>
        </div>
      </div>
    </Floating>
  );
}
