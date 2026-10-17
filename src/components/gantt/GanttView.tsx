"use client";
// מצב גאנט רגיל: שורות עבודה אמיתיות, יצירת תכולה בסימון טווח, גרירה/שינוי אורך, תפריטי הקשר.
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Plus, MoreVertical, Trash2, ArrowUpToLine, ArrowDownToLine, Diamond, Flag, ExternalLink, PanelTopOpen, Pencil, Eye, EyeOff, X, RectangleHorizontal,
} from "lucide-react";
import type { ItemDTO, MilestoneDTO, PlanData, RowDTO, SprintDTO, ViewConfig } from "@/lib/types";
import { CROSS_ROW_LABELS, DELETED_RETENTION_DAYS } from "@/lib/constants";
import { useCatalog } from "@/components/CatalogProvider";
import {
  buildTimeline, dayOfWeek, fmtDate, addDays, weekEndOf, weekRangeLabel, weekNumber, weekStartOf, daysDiff,
  type ISODate, type Timeline,
} from "@/lib/weeks";
import { msCanEdit, msScopeLabel } from "@/lib/milestone";
import { layoutLanes } from "@/lib/compare";
import { useTooltip } from "@/components/ui/tooltip";
import { Floating, MenuItem } from "@/components/ui/popover";
import { useConfirm } from "@/components/ui/dialog";
import { findOverlap, type PlanStore } from "@/components/plan/store";
import { uiZoom, useBarFontSize } from "@/components/plan/prefs";
import { useWorkspaceUI, userName } from "@/components/plan/ui";
import { CROSS_FILTER, crossRowVisible, hasContentFilter, hideDomain, hideTeam, itemMatches, onlyDomain, timeWindow, visibleTeamIds } from "@/components/plan/filters";
import { useToast } from "@/components/ui/toast";
import { GanttGrid, useCurrentWeek, type CrossGroup, type GanttGridHandle, type LaneSpec } from "./GanttGrid";
import { geometry } from "./geometry";

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
type QuickState = { rowId: number; laneKey: string; start: ISODate; end: ISODate; x: number; y: number; initialName?: string };
type SummaryState = { itemId: number; x: number; y: number };
type MenuState = { x: number; y: number; lane?: LaneSpec; teamId: number | null; week?: ISODate; item?: ItemDTO; milestone?: MilestoneDTO; sprint?: SprintDTO; label?: { domainId: number; teamId: number | null } };
/** טווח מסומן (לחיצה/גרירה על שורה): מוצג עם "+" באמצע; לחיצה עליו פותחת: תכולה / אבן דרך / ספרינט */
type PickState = { rowId: number; laneKey: string; teamId: number | null; start: ISODate; end: ISODate; menu?: { x: number; y: number } };

export type GanttHandle = { goToday: () => void };

export const GanttView = memo(forwardRef<GanttHandle, { store: PlanStore; view: ViewConfig; setView?: (v: ViewConfig) => void }>(function GanttView({ store, view, setView }, ref) {
  const data = store.data!;
  const ui = useWorkspaceUI();
  const tip = useTooltip();
  const confirm = useConfirm();
  const cat = useCatalog();
  const toast = useToast();
  const [barFont] = useBarFontSize(ui.me.preferences);
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
  const [pick, setPick] = useState<PickState | null>(null);
  const lastPick = useRef<{ key: string; at: number } | null>(null); // לזיהוי לחיצה כפולה על אותו תא
  const [marker, setMarker] = useState<{ x: number; y: number; milestone?: MilestoneDTO; sprint?: SprintDTO } | null>(null);
  const [summary, setSummary] = useState<SummaryState | null>(null);
  // לחיצה אחת פותחת תקציר, לחיצה כפולה את חלונית העריכה — ממתינים רגע כדי להבחין ביניהן
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // רק חלונית קופצת אחת פתוחה בכל רגע: כל פתיחה סוגרת את הקודמות (תקציר, תפריט, סימון טווח, הוספה מהירה, תקציר אבן דרך/ספרינט)
  const closeAll = useCallback(() => {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    setSummary(null); setMenu(null); setPick(null); setQuick(null); setMarker(null);
    tip.hide();
  }, [tip]);
  const openMenu = useCallback((m: MenuState) => { closeAll(); setMenu(m); }, [closeAll]);
  const openQuick = useCallback((q: QuickState) => { closeAll(); setQuick(q); }, [closeAll]);
  const openPick = useCallback((p: PickState) => { closeAll(); setPick(p); }, [closeAll]);
  const openMarker = useCallback((m: { x: number; y: number; milestone?: MilestoneDTO; sprint?: SprintDTO }) => { closeAll(); setMarker(m); }, [closeAll]);
  const openSummary = useCallback((item: ItemDTO, x: number, y: number) => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => { closeAll(); setSummary({ itemId: item.id, x, y }); }, 250);
  }, [closeAll]);
  const openFull = useCallback((id: number) => {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    setSummary(null);
    ui.openItem(id);
  }, [ui]);
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);
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
      if (!crossRowVisible(view, kind)) continue; // סינון התחומים יכול להסתיר גם את השורות הרוחביות
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
  }, [data.rows, data.items, timeline, crossLaneH, store, view.domainIds]); // eslint-disable-line react-hooks/exhaustive-deps

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
    let dWeeks = Math.round(dx / (weekW * uiZoom()));
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
      if (!d.started) { openSummary(d.item, e.clientX, e.clientY); return; }
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

  // הטווח המסומן: Escape מבטל, Enter = הוספת תכולה, לחיצה מחוץ לגאנט מבטלת
  useEffect(() => {
    if (!pick || pick.menu) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Escape") setPick(null);
      // התחלת הקלדה כשיש טווח מסומן = הוספת תכולה, והתו הראשון כבר בשם
      const typed = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " " ? e.key : undefined;
      if (e.key === "Enter" || typed) {
        e.preventDefault();
        const el = document.querySelector<HTMLElement>("[data-testid=sel-plus]")?.getBoundingClientRect();
        setPick(null);
        openQuick({ rowId: pick.rowId, laneKey: pick.laneKey, start: pick.start, end: pick.end, x: el ? el.left : 400, y: el ? el.bottom : 300, initialName: typed });
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-pick], [data-testid=sel-menu], [data-testid=gantt-scroll]")) setPick(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [pick]);

  // ---------- סימון טווח ליצירת תכולה ----------
  const selRef = useRef<SelState | null>(null);
  selRef.current = sel;
  const onLaneMouseDown = useCallback((e: React.MouseEvent, lane: LaneSpec, teamId: number | null, wi: number) => {
    if ((e.target as HTMLElement).closest("[data-bar],[data-marker]")) return;
    if (!lane.editable || wi < 0 || wi >= n) return;
    if (teamId !== null && view.showItems === false) return; // שכבת התכולות מוסתרת — לא יוצרים תכולה "בלתי נראית"
    (document.activeElement as HTMLElement | null)?.blur?.(); // שומר עריכה פתוחה בחלונית לפני הפעולה
    e.preventDefault();
    closeAll();
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
      const w = Math.floor((r.right - ev.clientX) / (weekW * uiZoom()));
      setSel((s) => (s ? { ...s, b: Math.max(s.min, Math.min(s.max, w)) } : s));
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const s = selRef.current;
      setSel(null);
      if (!s) return;
      const lo = Math.min(s.a, s.b), hi = Math.max(s.a, s.b);
      const start = timeline.weeks[lo].start, end = timeline.weeks[hi].start;
      // לחיצה כפולה על אותו תא = קיצור דרך: ישר להוספת תכולה
      const key = `${s.laneKey}|${start}|${end}`;
      const dbl = lo === hi && lastPick.current?.key === key && Date.now() - lastPick.current.at < 450;
      lastPick.current = { key, at: Date.now() };
      if (dbl) { openQuick({ rowId: s.rowId, laneKey: s.laneKey, start, end, x: ev.clientX, y: ev.clientY }); return; }
      openPick({ rowId: s.rowId, laneKey: s.laneKey, teamId: s.teamId, start, end });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [data.rows, itemsByRow, idxOf, n, timeline, weekW, view.showItems, closeAll]);

  const onLaneContextMenu = useCallback((e: React.MouseEvent, lane: LaneSpec, teamId: number | null, wi: number) => {
    const barEl = (e.target as HTMLElement).closest<HTMLElement>("[data-bar]");
    const item = barEl ? data.items.find((i) => i.id === Number(barEl.dataset.bar)) : undefined;
    openMenu({ x: e.clientX, y: e.clientY, lane, teamId, week: wi >= 0 && wi < n ? timeline.weeks[wi].start : undefined, item });
  }, [data.items, n, timeline]);

  // ---------- רינדור קוביות ----------
  const startDrag = (e: React.MouseEvent, item: ItemDTO, mode: DragState["mode"], editable: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    closeAll();
    (document.activeElement as HTMLElement | null)?.blur?.();
    e.preventDefault();
    tip.hide();
    if (!editable) return; // ללא הרשאה אין גרירה — הלחיצה מטופלת ב-onClick
    setDrag({ item, mode, originX: e.clientX, originY: e.clientY, started: false, dWeeks: 0, targetRowId: item.rowId, valid: true });
  };

  const itemTip = (i: ItemDTO) => (
    <div className="space-y-0.5">
      <div className="font-semibold">{i.name}</div>
      <div className="opacity-80">ID {i.id} · {cat.status(i.status).label}{i.priority !== cat.defaultPriority ? ` · תיעדוף ${cat.priority(i.priority).label}` : ""}</div>
      <div className="opacity-80">שבועות {weekNumber(i.startWeek)}–{weekNumber(i.endWeek)} · {fmtDate(i.startWeek)}–{fmtDate(weekEndOf(i.endWeek))}</div>
      {i.notes && <div className="max-w-[300px] truncate opacity-70">{i.notes}</div>}
      <div className="opacity-60">עודכן ע״י {userName(data, i.updatedById)}</div>
    </div>
  );

  const renderBar = (i: ItemDTO, editable: boolean, height: number, opts?: { ghost?: boolean; start?: ISODate; end?: ISODate; invalid?: boolean }) => {
    const box = barBox(opts?.start ?? i.startWeek, opts?.end ?? i.endWeek);
    if (!box) return null;
    const m = cat.status(i.status);
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
          (selected || summary?.itemId === i.id) && "ring-2 ring-brand-500 ring-offset-1",
          box.cutStart && "rounded-r-none border-r-dashed",
          box.cutEnd && "rounded-l-none")}
        style={{ right: box.right, width: box.width, top: 3, height: height - 6, background: m.bg, color: m.fg, borderColor: m.border, fontSize: barFont }}
        onMouseDown={(e) => startDrag(e, i, "move", editable)}
        onMouseMove={(e) => { if (!drag && summary?.itemId !== i.id) tip.show(itemTip(i), e, { delay: 600 }); }}
        onMouseLeave={tip.hide}
        onClick={editable ? undefined : (e) => openSummary(i, e.clientX, e.clientY)}
        onDoubleClick={() => openFull(i.id)}
        role={opts?.ghost ? undefined : "button"} tabIndex={opts?.ghost ? undefined : 0}
        aria-label={opts?.ghost ? undefined : `${i.name}, ${cat.status(i.status).label}, שבועות ${weekNumber(i.startWeek)}–${weekNumber(i.endWeek)}`}
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
    // שכבת התכולות ניתנת להסתרה (שורות הצוותים בלבד — המידע הרוחבי תמיד מוצג)
    const items = teamId === null ? crossLayout.laneItems.get(lane.key) ?? [] : view.showItems === false ? [] : itemsByRow.get(lane.rowId) ?? [];
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
    if (pick && pick.laneKey === lane.key) {
      const lo = idxOf(pick.start), hi = idxOf(pick.end);
      const sz = Math.min(22, lane.height - 6);
      out.push(<div key="p" data-pick className="select-range pointer-events-none absolute z-20 rounded" style={{ right: lo * weekW + 1, width: (hi - lo + 1) * weekW - 2, top: 3, height: lane.height - 6 }} />);
      out.push(
        <button key="p+" data-pick data-testid="sel-plus" aria-label="הוספה בטווח המסומן" title="הוספה (תכולה / אבן דרך / ספרינט) · לחיצה כפולה על תא = תכולה"
          className="anim-in absolute z-[22] flex items-center justify-center rounded-full bg-brand-600 text-white shadow-pop transition hover:scale-110 hover:bg-brand-700"
          style={{ right: ((lo + hi + 1) / 2) * weekW - sz / 2, top: (lane.height - sz) / 2, width: sz, height: sz }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            // ה-"+" מופיע בדיוק מתחת לסמן: לחיצה מהירה עליו מיד אחרי הסימון = לחיצה כפולה על התא → ישר להוספת תכולה
            if (lastPick.current && Date.now() - lastPick.current.at < 400) {
              const p = pick; setPick(null); lastPick.current = null;
              openQuick({ rowId: p.rowId, laneKey: p.laneKey, start: p.start, end: p.end, x: e.clientX, y: e.clientY });
              return;
            }
            const r = e.currentTarget.getBoundingClientRect(); setPick((p) => (p ? { ...p, menu: { x: r.left + r.width / 2, y: r.bottom } } : p));
          }}>
          <Plus size={Math.round(sz * 0.65)} />
        </button>,
      );
    }
    const ghostHere = drag?.started && drag.targetRowId === lane.rowId &&
      (teamId === null ? (crossLayout.laneItems.get(lane.key) ?? []).some((i) => i.id === drag.item.id) : lane.isRowStart);
    if (drag?.started && ghostHere) {
      const { start, end } = dragRange(drag.item, drag.mode, drag.dWeeks);
      out.push(renderBar(drag.item, true, lane.height, { ghost: true, start, end, invalid: !drag.valid }));
    }
    // אבני דרך רוחביות בשורת "מופעים רוחביים"
    if (teamId === null && view.showMilestones && row?.kind === "CROSS_EVENT" && lane.isRowStart && lane.rowIndex === 0) {
      for (const m of data.milestones.filter((x) => x.teamId === null && x.domainId === null)) out.push(renderMilestone(m, lane.height));
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
        onClick={(e) => openMarker({ x: e.clientX, y: e.clientY, milestone: m })}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY, teamId: m.teamId, milestone: m }); }}
        onMouseMove={(e) => tip.show(<div><div className="font-semibold">◆ {m.name}</div><div className="opacity-80">{fmtDate(m.date)} · {msScopeLabel(m, data)}</div>{m.notes && <div className="opacity-70">{m.notes}</div>}</div>, e, { delay: 600, anchor: e.currentTarget })}
        onMouseLeave={tip.hide} aria-label={`אבן דרך: ${m.name}`} data-ms-scope={m.teamId !== null ? "team" : m.domainId !== null ? "domain" : "cross"}>
        {/* השם — קטן ועדין מעל המעוין, כדי שאפשר לזהות את אבן הדרך בלי לרחף */}
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-[3px] max-w-[140px] -translate-x-1/2 truncate whitespace-nowrap rounded-sm bg-white/75 px-[3px] text-[10px] font-medium leading-[13px] text-violet-700/90" data-ms-label>{m.name}</span>
        {/* אבן דרך של תחום שלם: מעוין עם מסגרת סגולה ומרכז לבן — להבדיל מאבן דרך של צוות */}
        <span className={clsx("block h-3 w-3 rotate-45 rounded-[2px] border-2 shadow", m.domainId !== null ? "border-violet-600 bg-white" : "border-white bg-violet-600")} />
      </button>
    );
  };

  // אבני דרך לפי צוות. אבן דרך של תחום: הקו עובר בכל צוותי התחום, והמעוין מוצג פעם אחת — בצוות הראשון המוצג בתחום
  const { msByTeam, msMarkersByTeam } = useMemo(() => {
    const lines = new Map<number, MilestoneDTO[]>(), markers = new Map<number, MilestoneDTO[]>();
    const add = (map: Map<number, MilestoneDTO[]>, teamId: number, x: MilestoneDTO) => { if (!map.has(teamId)) map.set(teamId, []); map.get(teamId)!.push(x); };
    for (const x of data.milestones) {
      if (x.teamId !== null) { add(lines, x.teamId, x); add(markers, x.teamId, x); }
      else if (x.domainId !== null) {
        const ts = teams.filter((t) => t.domainId === x.domainId);
        ts.forEach((t) => add(lines, t.id, x));
        if (ts[0]) add(markers, ts[0].id, x);
      }
    }
    return { msByTeam: lines, msMarkersByTeam: markers };
  }, [data.milestones, teams]);

  const renderTeamOverlay = view.showMilestones ? (teamId: number, height: number) => (
    <>
      {(msByTeam.get(teamId) ?? []).map((m) => {
        const wi = idxOf(weekStartOf(m.date));
        if (wi < 0 || wi >= n) return null;
        return <div key={m.id} className="absolute w-0 border-r border-dashed border-violet-400/70" style={{ right: dateX(m.date), top: 0, height }} />;
      })}
    </>
  ) : undefined;
  // סמני אבני הדרך עצמם — בשכבה מעל הקוביות, כדי שקובייה באותו שבוע לא תסתיר אותם
  const renderTeamMarkers = view.showMilestones ? (teamId: number) => (
    <>{(msMarkersByTeam.get(teamId) ?? []).map((m) => renderMilestone(m, 10))}</>
  ) : undefined;

  const renderBodyOverlay = view.showMilestones ? () => (
    <>
      {data.milestones.filter((m) => m.teamId === null && m.domainId === null).map((m) => {
        const wi = idxOf(weekStartOf(m.date));
        if (wi < 0 || wi >= n) return null;
        return <div key={m.id} className="absolute inset-y-0 w-0 border-r border-dotted border-violet-300" style={{ right: dateX(m.date) }} />;
      })}
    </>
  ) : undefined;

  const sprintsByDomain = useMemo(() => {
    const m = new Map<number, SprintDTO[]>();
    for (const s of data.sprints) {
      if (!m.has(s.domainId)) m.set(s.domainId, []);
      m.get(s.domainId)!.push(s);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.startDate.localeCompare(b.startDate));
    return m;
  }, [data.sprints]);

  // ספרינטים "מולבשים" על בלוק התחום: פס שקוף עדין לאורך כל הצוותים בתחום (מתחת לקוביות),
  // קווים מקווקווים בתחילת הספרינט ובסופו, ולשונית שם קטנה היושבת על הגבול העליון של התחום.
  // ספרינטים עוקבים מתחלפים בעוצמת הגוון — כך רואים היכן אחד נגמר והבא מתחיל.
  const dayW = weekW / 7;
  const renderDomainOverlay = view.showSprints ? (domainId: number) => {
    const list = sprintsByDomain.get(domainId) ?? [];
    if (!list.length) return null;
    const dayStart = (d: ISODate) => idxOf(weekStartOf(d)) * weekW + dayOfWeek(d) * dayW; // קצה ימני (תחילת היום) ב-RTL
    const lanes = layoutLanes(list, [0], () => 0, (s) => [[idxOf(weekStartOf(s.startDate)) * 7 + dayOfWeek(s.startDate), idxOf(weekStartOf(s.endDate)) * 7 + dayOfWeek(s.endDate)]], (s) => s.id);
    const laneOf = new Map(lanes.flatMap((l) => l.units.map((s) => [s.id, l.laneIndex] as const)));
    return list.map((s, i) => {
      const x0 = dayStart(s.startDate), x1 = dayStart(s.endDate) + dayW;
      if (x1 <= 0 || x0 >= n * weekW) return null;
      const right = Math.max(0, x0), width = Math.min(n * weekW, x1) - right;
      const showTip = (e: React.MouseEvent) => tip.show(
        <div><div className="font-semibold">{s.name}</div><div className="opacity-80">{fmtDate(s.startDate)} – {fmtDate(s.endDate)} · {data.domains.find((d) => d.id === domainId)?.name}</div>{s.notes && <div className="opacity-70">{s.notes}</div>}</div>, e, { delay: 600, anchor: e.currentTarget });
      return (
        <div key={s.id} data-sprint={s.id}>
          <div className="sprint-band absolute inset-y-0" data-alt={i % 2 ? "1" : "0"} style={{ right, width }} />
          <button className="sprint-tab pointer-events-auto absolute z-[12] flex h-[15px] items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold leading-none"
            style={{ right: right + 3, top: -8 + (laneOf.get(s.id) ?? 0) * 16, maxWidth: Math.max(130, width - 6) }}
            onClick={(e) => openMarker({ x: e.clientX, y: e.clientY, sprint: s })} onMouseMove={showTip} onMouseLeave={tip.hide}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY, teamId: null, sprint: s }); }} aria-label={`ספרינט ${s.name}`}>
            <Flag size={9} className="shrink-0" /><span className="truncate">{s.name}</span>
          </button>
        </div>
      );
    });
  } : undefined;

  const rowMenu = (lane: LaneSpec, teamId: number, x: number, y: number) => openMenu({ x, y, lane, teamId });

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
        renderLane={renderLane} renderTeamOverlay={renderTeamOverlay} renderTeamMarkers={renderTeamMarkers} renderBodyOverlay={renderBodyOverlay}
        renderDomainOverlay={renderDomainOverlay} renderRowControl={renderRowControl} teamLabelExtra={teamLabelExtra}
        teamEditable={(t) => store.canEditTeam(t)}
        onLaneMouseDown={store.readOnly ? undefined : onLaneMouseDown} onLaneContextMenu={onLaneContextMenu}
        onLabelContextMenu={setView ? (e, domainId, teamId) => openMenu({ x: e.clientX, y: e.clientY, teamId, label: { domainId, teamId } }) : undefined} />

      {drag?.started && !drag.valid && drag.reason && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md bg-red-600 px-3 py-1.5 text-[12px] text-white shadow-pop">{drag.reason}</div>
      )}
      {drag?.started && drag.valid && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md bg-ink-900 px-3 py-1.5 text-[12px] text-white shadow-pop tabular-nums">
          {(() => { const r = dragRange(drag.item, drag.mode, drag.dWeeks); return `שבועות ${weekNumber(r.start)}–${weekNumber(r.end)} · ${weekRangeLabel(r.start).split("–")[0]} – ${fmtDate(weekEndOf(r.end))}`; })()}
        </div>
      )}

      {summary && (() => {
        const it = data.items.find((x) => x.id === summary.itemId);
        if (!it) return null;
        return <ItemSummary item={it} data={data} point={summary} editable={store.canEditRow(data.rows.find((r) => r.id === it.rowId))}
          onClose={() => setSummary(null)} onOpen={() => openFull(it.id)} />;
      })()}

      {marker && (
        <MarkerSummary marker={marker} data={data} store={store} confirm={confirm} onClose={() => setMarker(null)}
          onEdit={() => { const m = marker; setMarker(null); if (m.milestone) ui.openMilestone(m.milestone); else if (m.sprint) ui.openSprint(m.sprint); }}
          onNext={(pre) => { setMarker(null); ui.openSprint(null, pre); }} />
      )}

      {quick && <QuickCreate quick={quick} store={store} onClose={() => setQuick(null)}
        onMore={(name) => { const q = quick; setQuick(null); ui.openNewItem({ rowId: q.rowId, startWeek: q.start, endWeek: q.end, name }); }} />}

      <Floating open={!!pick?.menu} point={pick?.menu} onClose={() => setPick((p) => (p ? { ...p, menu: undefined } : p))}>
        {pick?.menu && (() => {
          const teamDomain = pick.teamId !== null ? data.teams.find((t) => t.id === pick.teamId)?.domainId : undefined;
          const canMs = pick.teamId === null ? store.canEditCross() : store.canEditTeam(pick.teamId);
          const canSprint = teamDomain !== undefined && store.canEditDomain(teamDomain);
          const range = pick.start === pick.end ? `שבוע ${weekNumber(pick.start)}` : `שבועות ${weekNumber(pick.start)}–${weekNumber(pick.end)}`;
          const go = (fn: () => void) => { setPick(null); fn(); };
          return (
            <div className="w-[220px] p-1.5" data-testid="sel-menu">
              <div className="px-2 pb-1.5 pt-0.5 text-[11px] text-ink-400">
                <div className="font-medium text-ink-500">{range}</div>
                <div dir="ltr" className="text-right tabular-nums">{fmtDate(pick.start)} – {fmtDate(weekEndOf(pick.end))}</div>
              </div>
              <PickOption color="bg-brand-600" icon={<RectangleHorizontal size={14} />} label="תכולה" testid="sel-add-item"
                onClick={() => go(() => openQuick({ rowId: pick.rowId, laneKey: pick.laneKey, start: pick.start, end: pick.end, x: pick.menu!.x, y: pick.menu!.y }))} />
              {canMs && <PickOption color="bg-violet-600" icon={<Diamond size={13} />} label={pick.teamId === null ? "אבן דרך רוחבית" : "אבן דרך"} testid="sel-add-milestone"
                onClick={() => go(() => ui.openMilestone(null, { teamId: pick.teamId, date: pick.start }))} />}
              {canSprint && <PickOption color="bg-teal-600" icon={<Flag size={13} />} label="ספרינט לתחום" testid="sel-add-sprint"
                onClick={() => go(() => ui.openSprint(null, { domainId: teamDomain!, startDate: pick.start, endDate: addDays(weekEndOf(pick.end), -2) }))} />}
            </div>
          );
        })()}
      </Floating>

      <Floating open={!!menu} point={menu ? { x: menu.x, y: menu.y } : undefined} onClose={() => setMenu(null)}>
        {menu && (
          <div className="w-[230px] p-1" onClick={() => setMenu(null)} data-testid="gantt-menu">
            {menu.label && setView ? (
              <LabelMenu label={menu.label} data={data} view={view} setView={setView} toast={toast} />
            ) : menu.milestone ? (() => {
              const m = menu.milestone;
              const ed = msCanEdit(m, store);
              return (
                <>
                  <div className="truncate px-2.5 pb-1 pt-1 text-[11px] font-semibold text-violet-700">◆ {m.name} · {fmtDate(m.date)}</div>
                  <MenuItem icon={ed ? <Pencil size={14} /> : <ExternalLink size={14} />} onClick={() => ui.openMilestone(m)}>{ed ? "עריכת אבן דרך" : "פרטי אבן דרך"}</MenuItem>
                  {ed && <MenuItem danger icon={<Trash2 size={14} />} onClick={async () => {
                    if (await confirm({ title: "מחיקת אבן דרך", text: `למחוק את "${m.name}"?`, confirm: "מחיקה", danger: true })) await store.deleteMilestone(m);
                  }}>מחיקת אבן דרך</MenuItem>}
                </>
              );
            })() : menu.sprint ? (
              <SprintMenu sprint={menu.sprint} store={store} onEdit={(sp) => ui.openSprint(sp)}
                onNext={(pre) => ui.openSprint(null, pre)} confirm={confirm} />
            ) : menu.item ? (
              <>
                <MenuItem icon={<ExternalLink size={14} />} onClick={() => ui.openItem(menu.item!.id)}>פתח פרטי תכולה</MenuItem>
                {store.canEditRow(data.rows.find((r) => r.id === menu.item!.rowId)) && (
                  <>
                    <div className="my-1 border-t border-ink-100" />
                    <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold text-ink-400">שינוי סטטוס</div>
                    <div className="grid grid-cols-2 gap-0.5 px-1">
                      {cat.statuses.map(({ key: s }) => (
                        <button key={s} onClick={() => void store.updateItem(menu.item!, { status: s })}
                          className={clsx("flex items-center gap-1.5 rounded px-1.5 py-1 text-start text-[12px] hover:bg-ink-100", menu.item!.status === s && "bg-ink-100 font-semibold")}>
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm border" style={{ background: cat.status(s).bg, borderColor: cat.status(s).border }} />
                          <span className="truncate">{cat.status(s).label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="my-1 border-t border-ink-100" />
                    <MenuItem danger icon={<Trash2 size={14} />} onClick={async () => {
                      if (await confirm({ title: "מחיקת תכולה", confirm: "מחיקה", danger: true, text: <>האם אתה בטוח שברצונך למחוק את &quot;{menu.item!.name}&quot;?<span className="mt-1.5 block text-[12px] text-ink-500">אם תרצה לשחזר, התכולה תהיה זמינה ב-{DELETED_RETENTION_DAYS} הימים הקרובים תחת &quot;תכולות שנמחקו&quot; (עם אותו ID).</span></> })) await store.deleteItem(menu.item!);
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
                {(() => {
                  const domainId = menu.teamId !== null ? data.teams.find((t) => t.id === menu.teamId)?.domainId : undefined;
                  return domainId !== undefined && store.canEditDomain(domainId) ? (
                    <MenuItem icon={<Flag size={14} />} onClick={() => ui.openSprint(null, { domainId, startDate: menu.week })}>הוסף ספרינט לתחום</MenuItem>
                  ) : null;
                })()}
                {menu.teamId !== null && menu.lane?.editable && (
                  <>
                    <div className="my-1 border-t border-ink-100" />
                    <MenuItem icon={<ArrowUpToLine size={14} />} onClick={() => void store.createRow(menu.teamId!, menu.lane!.rowId, "above")}>הוסף שורה מעל</MenuItem>
                    <MenuItem icon={<ArrowDownToLine size={14} />} onClick={() => void store.createRow(menu.teamId!, menu.lane!.rowId, "below")}>הוסף שורה מתחת</MenuItem>
                    <MenuItem danger icon={<Trash2 size={14} />} onClick={() => void deleteRow(menu.lane!.rowId)}>מחיקת שורה</MenuItem>
                  </>
                )}
                {!menu.lane?.editable && <div className="px-2.5 py-1.5 text-[12px] text-ink-400">אין הרשאת עריכה לאזור זה</div>}
                {view.showSprints && menu.week && menu.teamId !== null && (() => {
                  const dom = data.teams.find((t) => t.id === menu.teamId)?.domainId;
                  const sp = (sprintsByDomain.get(dom ?? -1) ?? []).find((x) => x.startDate <= weekEndOf(menu.week!) && x.endDate >= menu.week!);
                  return sp ? (
                    <>
                      <div className="my-1 border-t border-ink-100" />
                      <SprintMenu sprint={sp} store={store} onEdit={(s2) => ui.openSprint(s2)} onNext={(pre) => ui.openSprint(null, pre)} confirm={confirm} />
                    </>
                  ) : null;
                })()}
              </>
            )}
          </div>
        )}
      </Floating>
    </div>
  );
}));

/** קליק ימני על שם תחום/צוות: הסתרה מהתצוגה (משנה את הסינון) */
export function LabelMenu({ label, data, view, setView, toast }: {
  label: { domainId: number; teamId: number | null }; data: PlanData; view: ViewConfig; setView: (v: ViewConfig) => void;
  toast: ReturnType<typeof useToast>;
}) {
  const crossName = label.domainId === CROSS_FILTER.INFLUENCE ? CROSS_ROW_LABELS.INFLUENCE : label.domainId === CROSS_FILTER.CROSS_EVENT ? CROSS_ROW_LABELS.CROSS_EVENT : null;
  const dom = crossName ? { id: label.domainId, name: crossName } : data.domains.find((d) => d.id === label.domainId);
  const team = label.teamId !== null ? data.teams.find((t) => t.id === label.teamId) : undefined;
  const apply = (v: ViewConfig | null, what: string) => {
    if (!v) { toast.show("error", `לא ניתן להסתיר את ה${what} האחרון שמוצג`); return; }
    setView(v);
  };
  const filtered = view.domainIds.length > 0 || view.teamIds.length > 0;
  return (
    <>
      <div className="truncate px-2.5 pb-1 pt-1 text-[11px] font-semibold text-ink-500">{dom?.name}{team && team.name !== dom?.name ? ` / ${team.name}` : ""}</div>
      {team && <MenuItem icon={<EyeOff size={14} />} onClick={() => apply(hideTeam(view, data, team.id), "צוות")}>הסתרת הצוות &quot;{team.name}&quot;</MenuItem>}
      <MenuItem icon={<EyeOff size={14} />} onClick={() => apply(hideDomain(view, data, label.domainId), "תחום")}>{crossName ? <>הסתרת השורה &quot;{crossName}&quot;</> : <>הסתרת התחום &quot;{dom?.name}&quot;</>}</MenuItem>
      <MenuItem icon={<Eye size={14} />} onClick={() => setView(onlyDomain(view, label.domainId))}>{crossName ? "הצגת השורה הזו בלבד" : "הצגת התחום הזה בלבד"}</MenuItem>
      {filtered && <MenuItem icon={<Eye size={14} />} onClick={() => setView({ ...view, domainIds: [], teamIds: [] })}>הצגת כל התחומים והצוותים</MenuItem>}
    </>
  );
}

/** לחיצה על אבן דרך / לשונית ספרינט: תקציר (ולא ישר עריכה). מהתקציר — עריכה, "הספרינט הבא", מחיקה. */
function MarkerSummary({ marker, data, store, confirm, onClose, onEdit, onNext }: {
  marker: { x: number; y: number; milestone?: MilestoneDTO; sprint?: SprintDTO }; data: PlanData; store: PlanStore;
  confirm: ReturnType<typeof useConfirm>; onClose: () => void; onEdit: () => void; onNext: (pre: ReturnType<typeof nextSprintPrefill>) => void;
}) {
  const { milestone: m, sprint: sp } = marker;
  const editable = m ? msCanEdit(m, store) : sp ? store.canEditDomain(sp.domainId) : false;
  const scope = m ? msScopeLabel(m, data) : `${data.domains.find((d) => d.id === sp!.domainId)?.name ?? ""} (כל הצוותים בתחום)`;
  return (
    <Floating open point={marker} onClose={onClose}>
      <div className="relative w-[290px] p-3 text-[12.5px]" data-testid="marker-summary">
        <button className="icon-btn absolute left-1.5 top-1.5 h-6 w-6" onClick={onClose} aria-label="סגירה"><X size={14} /></button>
        <div className="mb-1.5 flex items-center gap-2 pl-6">
          {m ? <span className="h-3 w-3 shrink-0 rotate-45 rounded-[2px] bg-violet-600" /> : <Flag size={14} className="shrink-0 text-teal-600" />}
          <div className="font-semibold leading-snug text-ink-900">{m?.name ?? sp!.name}</div>
        </div>
        <div className="space-y-0.5 text-ink-600">
          <div>{m ? "אבן דרך" : "ספרינט"} · {scope}</div>
          <div className="tabular-nums">{m ? fmtDate(m.date) : `${fmtDate(sp!.startDate)} – ${fmtDate(sp!.endDate)}`}</div>
          {(m?.notes || sp?.notes) && <div className="line-clamp-3 whitespace-pre-line text-ink-500">{m?.notes || sp?.notes}</div>}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button className="btn-primary btn-sm gap-1" autoFocus onClick={onEdit} data-testid="marker-edit">
            {editable ? <><Pencil size={13} /> עריכה</> : <><Eye size={13} /> פרטים</>}
          </button>
          {sp && editable && <button className="btn-secondary btn-sm" onClick={() => onNext(nextSprintPrefill(sp))}><Plus size={13} />הספרינט הבא</button>}
          {editable && <button className="btn-ghost btn-sm mr-auto text-red-600 hover:bg-red-50" onClick={async () => {
            onClose();
            if (await confirm({ title: m ? "מחיקת אבן דרך" : "מחיקת ספרינט", text: `למחוק את "${m?.name ?? sp!.name}"?`, confirm: "מחיקה", danger: true })) {
              if (m) await store.deleteMilestone(m); else await store.deleteSprint(sp!);
            }
          }}><Trash2 size={13} /></button>}
        </div>
      </div>
    </Floating>
  );
}

function PickOption({ color, icon, label, onClick, testid }: { color: string; icon: React.ReactNode; label: string; onClick: () => void; testid: string }) {
  return (
    <button onClick={onClick} data-testid={testid} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-[13px] text-ink-800 hover:bg-ink-100">
      <span className={clsx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white", color)}>{icon}</span>
      הוספת {label}
    </button>
  );
}

/** "הספרינט הבא": מתחיל ביום ראשון שאחרי סיום הספרינט, באותו אורך, והמספר בשם עולה ב-1 */
export function nextSprintPrefill(s: SprintDTO) {
  const len = daysDiff(s.startDate, s.endDate);
  let start = addDays(s.endDate, 1);
  if (dayOfWeek(start) !== 0) start = addDays(weekStartOf(start), 7);
  const m = s.name.match(/^(.*?)(\d+)(\D*)$/);
  const name = m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : `${s.name} (הבא)`;
  return { domainId: s.domainId, startDate: start, endDate: addDays(start, len), name };
}

function SprintMenu({ sprint: s, store, onEdit, onNext, confirm }: {
  sprint: SprintDTO; store: PlanStore; onEdit: (s: SprintDTO) => void;
  onNext: (pre: ReturnType<typeof nextSprintPrefill>) => void; confirm: ReturnType<typeof useConfirm>;
}) {
  const ed = store.canEditDomain(s.domainId);
  return (
    <>
      <div className="truncate px-2.5 pb-1 pt-1 text-[11px] font-semibold text-teal-700">⚑ {s.name} · {fmtDate(s.startDate)}–{fmtDate(s.endDate)}</div>
      <MenuItem icon={ed ? <Pencil size={14} /> : <ExternalLink size={14} />} onClick={() => onEdit(s)}>{ed ? "עריכת ספרינט" : "פרטי ספרינט"}</MenuItem>
      {ed && <MenuItem icon={<Plus size={14} />} onClick={() => onNext(nextSprintPrefill(s))}>הוספת הספרינט הבא</MenuItem>}
      {ed && <MenuItem danger icon={<Trash2 size={14} />} onClick={async () => {
        if (await confirm({ title: "מחיקת ספרינט", text: `למחוק את "${s.name}"?`, confirm: "מחיקה", danger: true })) await store.deleteSprint(s);
      }}>מחיקת ספרינט</MenuItem>}
    </>
  );
}

export function dragRange(item: ItemDTO, mode: DragState["mode"], d: number): { start: ISODate; end: ISODate } {
  const add = (s: ISODate, w: number) => {
    const t = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + w * 7));
    return t.toISOString().slice(0, 10);
  };
  if (mode === "move") return { start: add(item.startWeek, d), end: add(item.endWeek, d) };
  if (mode === "start") return { start: add(item.startWeek, d), end: item.endWeek };
  return { start: item.startWeek, end: add(item.endWeek, d) };
}

function ItemSummary({ item, data, point, editable, onClose, onOpen }: {
  item: ItemDTO; data: PlanData; point: { x: number; y: number }; editable: boolean; onClose: () => void; onOpen: () => void;
}) {
  const cat = useCatalog();
  const m = cat.status(item.status);
  return (
    <Floating open point={point} onClose={onClose}>
      <div className="relative w-[300px] p-3 text-[12.5px]" data-testid="item-summary">
        <button className="icon-btn absolute left-1.5 top-1.5 h-6 w-6" onClick={onClose} aria-label="סגירה" title="סגירה (Esc)"><X size={14} /></button>
        <div className="mb-1.5 flex items-start gap-2 pl-6">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-sm border" style={{ background: m.bg, borderColor: m.border }} />
          <div className="font-semibold leading-snug text-ink-900">{item.name}</div>
        </div>
        <div className="space-y-0.5 text-ink-600">
          <div>ID {item.id} · {m.label}{item.priority !== cat.defaultPriority ? ` · תיעדוף ${cat.priority(item.priority).label}` : ""}</div>
          <div className="tabular-nums">שבועות {weekNumber(item.startWeek)}–{weekNumber(item.endWeek)} · {fmtDate(item.startWeek)}–{fmtDate(weekEndOf(item.endWeek))}</div>
          {item.notes && <div className="line-clamp-3 whitespace-pre-line text-ink-500">{item.notes}</div>}
          <div className="text-ink-400">עודכן ע״י {userName(data, item.updatedById)}</div>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <button className="btn-primary btn-sm gap-1" autoFocus onClick={onOpen} data-testid="summary-open">
            {editable ? <><Pencil size={13} /> עריכה</> : <><Eye size={13} /> פרטים מלאים</>}
          </button>
          <span className="mr-auto text-[11px] text-ink-400">לחיצה כפולה פותחת ישירות</span>
        </div>
      </div>
    </Floating>
  );
}

function QuickCreate({ quick, store, onClose, onMore }: { quick: QuickState; store: PlanStore; onClose: () => void; onMore: (name: string) => void }) {
  const [name, setName] = useState(quick.initialName ?? "");
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
      <div className="relative w-[300px] p-3" data-testid="quick-create">
        <button className="icon-btn absolute left-1.5 top-1.5 h-6 w-6" onClick={onClose} aria-label="ביטול" title="ביטול (Esc)" data-testid="quick-close"><X size={14} /></button>
        <div className="mb-2 pl-6 text-[12px] text-ink-500">
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
