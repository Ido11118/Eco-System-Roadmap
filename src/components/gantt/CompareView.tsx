"use client";
// מצב "תכנון מול ביצוע": קריאה בלבד. כל ID = יחידת תצוגה אחת (תכנון + מצב נוכחי באותה שורה וירטואלית).
import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PlanData, ViewConfig } from "@/lib/types";
import { STATUS_META } from "@/lib/constants";
import {
  buildCompareLayout, summarize, COMPARE_FILTERS, TAG_LABELS, type CompareUnit,
} from "@/lib/compare";
import { buildTimeline, fmtDate, weekEndOf, weekNumber, type ISODate } from "@/lib/weeks";
import { useTooltip } from "@/components/ui/tooltip";
import { useWorkspaceUI } from "@/components/plan/ui";
import { itemMatches, timeWindow, visibleTeamIds } from "@/components/plan/filters";
import { GanttGrid, useCurrentWeek, type CrossGroup, type GanttGridHandle, type LaneSpec } from "./GanttGrid";
import { geometry } from "./geometry";

export type CompareHandle = { goToday: () => void };

export const CompareView = memo(forwardRef<CompareHandle, {
  current: PlanData; baseline: PlanData; view: ViewConfig; filterKey: string; onFilterKey: (k: string) => void; baselineLabel: string;
}>(function CompareView({ current, baseline, view, filterKey, onFilterKey, baselineLabel }, ref) {
  const tip = useTooltip();
  const ui = useWorkspaceUI();
  const gridRef = useRef<GanttGridHandle>(null);
  const { weekW, rowH, crossLaneH } = geometry(view.density, true);
  const merged = useMemo<PlanData>(() => ({ ...current, items: [...current.items, ...baseline.items] }), [current, baseline]);
  const [w0, w1] = timeWindow(view.time, merged);
  const timeline = useMemo(() => buildTimeline(w0, w1), [w0, w1]);
  const cw = useCurrentWeek();
  const todayIndex = timeline.indexOf(cw);
  useImperativeHandle(ref, () => ({ goToday: () => gridRef.current?.scrollToIndex(Math.max(0, todayIndex)) }), [todayIndex]);
  useLayoutEffect(() => {
    gridRef.current?.scrollToIndex(todayIndex >= 0 ? todayIndex : 0, false);
  }, [w0, w1, weekW]); // eslint-disable-line react-hooks/exhaustive-deps

  const cf = COMPARE_FILTERS.find((f) => f.key === filterKey) ?? COMPARE_FILTERS[0];
  // מסננים רגילים (סטטוס/תיעדוף/חיפוש) חלים על המצב הנוכחי, או על התכנון לתכולה שנמחקה
  const contentMatch = (u: CompareUnit) => {
    const ref = u.actual?.item ?? baseline.items.find((i) => i.id === u.id);
    return ref ? itemMatches(ref, view) : true;
  };
  // מבנה התצוגה = איחוד המבנה הנוכחי והמבנה ב-Snapshot — כדי שתכולות של צוות שכבר אינו קיים לא ייעלמו
  const structure = useMemo(() => ({
    teams: [...current.teams, ...baseline.teams.filter((t) => !current.teams.some((c) => c.id === t.id))],
    domains: [...current.domains, ...baseline.domains.filter((d) => !current.domains.some((c) => c.id === d.id))],
  }), [current, baseline]);
  const teamsVisible = useMemo(() => visibleTeamIds({ ...current, ...structure }, view), [current, structure, view]);
  const layout = useMemo(() => buildCompareLayout(baseline, current, (u) => cf.match(u) && contentMatch(u)),
    [baseline, current, cf, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const allUnits = useMemo(() => buildCompareLayout(baseline, current).units, [baseline, current]);
  const summaryUnits = useMemo(() => allUnits.filter((u) =>
    (u.teamId === null || teamsVisible.has(u.teamId)) && contentMatch(u)), [allUnits, teamsVisible, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => summarize(summaryUnits), [summaryUnits]);

  const laneUnits = useMemo(() => new Map<string, CompareUnit[]>(), [layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const teamLanes = useMemo(() => {
    const m = new Map<number, LaneSpec[]>();
    for (const t of structure.teams) {
      const lanes = layout.lanes.get(`team:${t.id}`) ?? [];
      let rowIdx = -1, lastRow = -1;
      m.set(t.id, lanes.map((l) => {
        if (l.rowId !== lastRow) { rowIdx++; lastRow = l.rowId; }
        const key = `c-${t.id}-${l.rowId}-${l.laneIndex}`;
        laneUnits.set(key, l.units);
        return { key, rowId: l.rowId, height: rowH, isRowStart: l.laneIndex === 0, rowIndex: rowIdx, virtual: l.laneIndex > 0, editable: false };
      }));
    }
    return m;
  }, [structure.teams, layout, rowH, laneUnits]);
  const crossGroups: CrossGroup[] = useMemo(() => (["INFLUENCE", "CROSS_EVENT"] as const).map((kind) => {
    const lanes = layout.lanes.get(`cross:${kind}`) ?? [];
    return {
      kind, label: kind === "INFLUENCE" ? "גורמים משפיעים" : "מופעים רוחביים", editable: false,
      lanes: lanes.map((l, i) => {
        const key = `cx-${kind}-${l.rowId}-${l.laneIndex}`;
        laneUnits.set(key, l.units);
        return { key, rowId: l.rowId, height: crossLaneH + 10, isRowStart: l.laneIndex === 0, rowIndex: i, virtual: l.laneIndex > 0, editable: false };
      }),
    };
  }), [layout, crossLaneH, laneUnits]);

  const n = timeline.weeks.length;
  const box = (s: ISODate, e: ISODate) => {
    const a = timeline.indexOf(s), b = timeline.indexOf(e);
    if (b < 0 || a >= n) return null;
    const ca = Math.max(0, a), cb = Math.min(n - 1, b);
    return { right: ca * weekW + 2, width: (cb - ca + 1) * weekW - 4 };
  };

  const unitTip = (u: CompareUnit) => (
    <div className="space-y-0.5">
      <div className="font-semibold">{u.name} <span className="font-normal opacity-70">· ID {u.id}</span></div>
      <div>תוכנן: {u.plan ? `שבועות ${weekNumber(u.plan.start)}–${weekNumber(u.plan.end)} (${fmtDate(u.plan.start)}–${fmtDate(weekEndOf(u.plan.end))})` : "לא היה בתכנון"}</div>
      <div>מצב נוכחי: {u.actual ? `שבועות ${weekNumber(u.actual.start)}–${weekNumber(u.actual.end)} (${fmtDate(u.actual.start)}–${fmtDate(weekEndOf(u.actual.end))})` : "נמחק"}</div>
      {u.actual && <div>סטטוס נוכחי: {STATUS_META[u.actual.status].label}{u.plan && u.plan.status !== u.actual.status ? ` (בתכנון: ${STATUS_META[u.plan.status].label})` : ""}</div>}
      {u.startDelta !== null && (u.startDelta !== 0 || u.endDelta !== 0) && (
        <div>הפרש: התחלה {fmtDelta(u.startDelta)} · סיום {fmtDelta(u.endDelta!)}</div>
      )}
      <div className="pt-0.5 opacity-90">{u.description}</div>
      <div className="flex flex-wrap gap-1 pt-1">{u.tags.map((t) => <span key={t} className="rounded bg-white/15 px-1.5 text-[11px]">{TAG_LABELS[t]}</span>)}</div>
    </div>
  );

  const renderLane = (lane: LaneSpec) => {
    const units = laneUnits.get(lane.key) ?? [];
    const h = lane.height;
    return units.map((u) => {
      const pb = u.plan ? box(u.plan.start, u.plan.end) : null;
      const ab = u.actual ? box(u.actual.start, u.actual.end) : null;
      const deleted = !u.actual;
      const added = !u.plan;
      const m = u.actual ? STATUS_META[u.actual.status] : null;
      const events = {
        onMouseMove: (e: React.MouseEvent) => tip.show(unitTip(u), e),
        onMouseLeave: tip.hide,
        onClick: () => { if (u.actual) ui.openItem(u.id); },
      };
      return (
        <div key={u.id} data-unit={u.id}>
          {pb && (
            <div {...events} data-plan={u.id}
              className={clsx("plan-ghost absolute z-10 flex items-center overflow-hidden rounded-[4px] text-[10.5px] text-ink-700",
                deleted && "!border-red-400 !bg-red-50/70 cursor-default")}
              style={deleted ? { right: pb.right, width: pb.width, top: 4, height: h - 8 } : { right: pb.right, width: pb.width, top: 3, height: 10 }}>
              {deleted && <span className="truncate px-1.5 text-[11.5px] line-through decoration-red-400">{u.name} · נמחק</span>}
            </div>
          )}
          {ab && m && (
            <div {...events} data-actual={u.id}
              className={clsx("gantt-bar absolute z-[11] flex cursor-pointer items-center gap-1 overflow-hidden rounded-[5px] border text-[11.5px] font-medium",
                added && "ring-1 ring-offset-1 ring-brand-400")}
              style={{ right: ab.right, width: ab.width, top: added ? 6 : 15, height: added ? h - 12 : h - 19, background: m.bg, color: m.fg, borderColor: m.border }}>
              {added && <span className="mr-1 shrink-0 rounded bg-brand-600 px-1 text-[9.5px] font-bold text-white">חדש</span>}
              <span className="truncate px-1">{u.name}</span>
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="flex h-full flex-col" data-testid="compare-view">
      <CompareSummaryBar summary={summary} units={summaryUnits} current={{ ...current, ...structure }} filterKey={filterKey} onFilterKey={onFilterKey} baselineLabel={baselineLabel} />
      <div className="min-h-0 flex-1">
        <GanttGrid ref={gridRef} timeline={timeline} weekW={weekW} domains={structure.domains}
          teams={structure.teams.filter((t) => teamsVisible.has(t.id))}
          teamLanes={teamLanes} crossGroups={crossGroups} todayIndex={todayIndex}
          renderLane={(lane) => renderLane(lane)} teamEditable={() => false} readOnlyHints={false}
          emptyText="אין תכולות להצגה לפי הסינון הנוכחי" />
      </div>
    </div>
  );
}));

function fmtDelta(d: number) {
  if (d === 0) return "ללא שינוי";
  return d > 0 ? `+${d} שב׳` : `${d} שב׳`;
}

function CompareSummaryBar({ summary: s, units, current, filterKey, onFilterKey, baselineLabel }: {
  summary: ReturnType<typeof summarize>; units: CompareUnit[]; current: PlanData; filterKey: string; onFilterKey: (k: string) => void; baselineLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pct = (x: number) => (s.planned ? Math.round((x / s.planned) * 100) : 0);
  const tiles: { k: string; label: string; v: number; sub?: string; color: string }[] = [
    { k: "all", label: "תוכננו", v: s.planned, sub: "ב-Snapshot", color: "#334155" },
    { k: "completed", label: "הושלמו", v: s.completed, sub: `${pct(s.completed)}% מהתכנון`, color: "#15803d" },
    { k: "notCompleted", label: "לא הושלמו", v: s.notCompleted, sub: `${pct(s.notCompleted)}%`, color: "#d97706" },
    { k: "delayed", label: "נדחו", v: s.delayed, sub: "בטווח הזמן", color: "#ca8a04" },
    { k: "advanced", label: "הוקדמו", v: s.advanced, color: "#0284c7" },
    { k: "cancelled", label: "בוטלו", v: s.cancelled, sub: `${pct(s.cancelled)}%`, color: "#52525b" },
    { k: "deleted", label: "נמחקו", v: s.deleted, sub: `${pct(s.deleted)}%`, color: "#dc2626" },
    { k: "added", label: "נוספו אחרי התכנון", v: s.added, sub: `${s.completedUnplanned} מהן הושלמו`, color: "#2563eb" },
  ];
  // פירוק לפי תחום
  const byDomain = useMemo(() => {
    const teamDomain = new Map(current.teams.map((t) => [t.id, t.domainId]));
    return current.domains.map((d) => {
      const us = units.filter((u) => u.teamId !== null && teamDomain.get(u.teamId) === d.id);
      return { d, s: summarize(us) };
    }).filter((x) => x.s.planned + x.s.added > 0);
  }, [units, current]);
  return (
    <div className="border-b border-ink-200 bg-white px-4 py-2.5">
      <div className="flex flex-wrap items-stretch gap-2">
        {tiles.map((t) => (
          <button key={t.k} onClick={() => onFilterKey(t.k)} title="סינון לפי מדד זה"
            className={clsx("min-w-[96px] rounded-lg border px-3 py-1.5 text-start transition hover:border-ink-300",
              filterKey === t.k ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white")}>
            <div className="text-[11px] text-ink-500">{t.label}</div>
            <div className="text-[19px] font-bold leading-tight tabular-nums" style={{ color: t.color }}>{t.v}</div>
            {t.sub && <div className="text-[10.5px] text-ink-400">{t.sub}</div>}
          </button>
        ))}
        <div className="mr-auto flex flex-col justify-between gap-1 text-[11.5px] text-ink-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><span className="plan-ghost inline-block h-2.5 w-7 rounded-sm" />תכנון ({baselineLabel})</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-7 rounded-sm border border-amber-600 bg-amber-500" />מצב נוכחי</span>
            <span className="flex items-center gap-1.5"><span className="rounded bg-brand-600 px-1 text-[9.5px] font-bold text-white">חדש</span>נוסף אחרי התכנון</span>
          </div>
          <div className="flex items-center gap-2">
            <select className="input h-7 w-auto py-0 text-[12px]" value={filterKey} onChange={(e) => onFilterKey(e.target.value)} data-testid="compare-filter">
              {COMPARE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <button className="btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
              פירוק לפי תחום {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-2.5 overflow-auto rounded-lg border border-ink-200">
          <table className="w-full text-[12px]">
            <thead className="bg-ink-50 text-ink-500">
              <tr>{["תחום", "תוכננו", "הושלמו", "לא הושלמו", "נדחו", "בוטלו", "נמחקו", "נוספו", "% השלמה"].map((h) => <th key={h} className="px-2.5 py-1.5 text-start font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {byDomain.map(({ d, s }) => (
                <tr key={d.id} className="border-t border-ink-100">
                  <td className="px-2.5 py-1 font-medium">{d.name}</td>
                  <td className="px-2.5 tabular-nums">{s.planned}</td><td className="px-2.5 tabular-nums">{s.completed}</td>
                  <td className="px-2.5 tabular-nums">{s.notCompleted}</td><td className="px-2.5 tabular-nums">{s.delayed}</td>
                  <td className="px-2.5 tabular-nums">{s.cancelled}</td><td className="px-2.5 tabular-nums">{s.deleted}</td>
                  <td className="px-2.5 tabular-nums">{s.added}</td><td className="px-2.5 tabular-nums">{Math.round(s.completionRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-ink-100 bg-ink-50/50 px-2.5 py-1.5 text-[11px] text-ink-500">
            תוכננו = הושלמו + לא הושלמו + בוטלו + נמחקו (מתוך תכולות ה-Snapshot בלבד). &quot;נדחו&quot; הוא מדד זמן נפרד. &quot;נוספו&quot; אינן נכללות באחוז ההשלמה.
          </p>
        </div>
      )}
    </div>
  );
}
