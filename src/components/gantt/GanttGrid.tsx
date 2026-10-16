"use client";
// שכבות (z-index): קוביות 10 · סימון/"+" 20–22 · אבני דרך 15/25 · עמודות התוויות הקפואות 28 (מעל כל תוכן הגאנט) · כותרות 30
// שלד הגאנט: גלילה, כותרות קפואות (שנה/חודש/שבוע), עמודות קפואות (תחום/צוות), שורות רוחביות בראש הגוף,
// בלוקים של תחום → צוות → נתיבים (שורות עבודה או שורות וירטואליות במצב השוואה).
// התוכן של כל נתיב מצויר ע"י הרכיב העוטף (מצב רגיל / השוואה) — אותו שלד לשני המצבים.
import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { DomainDTO, TeamDTO } from "@/lib/types";
import { currentWeekIL, weekRangeLabel, type ISODate, type Timeline } from "@/lib/weeks";
import { useTooltip } from "@/components/ui/tooltip";
import { uiZoom } from "@/components/plan/prefs";
import {
  CTRL_W, DOMAIN_W, HEADER_H, LABEL_W, MONTH_H, TEAM_W, WEEK_H, YEAR_H,
} from "./geometry";

export type LaneSpec = {
  key: string;
  rowId: number;
  height: number;
  isRowStart: boolean; // נתיב ראשון של שורת עבודה (לגבול עליון בולט יותר)
  rowIndex: number;
  virtual?: boolean; // שורה וירטואלית (מצב השוואה)
  editable: boolean;
};

export type CrossGroup = { kind: "INFLUENCE" | "CROSS_EVENT"; label: string; lanes: LaneSpec[]; editable: boolean };

export type GanttGridHandle = { scrollToIndex: (idx: number, smooth?: boolean) => void; el: HTMLDivElement | null };

type Props = {
  timeline: Timeline;
  weekW: number;
  domains: DomainDTO[];
  teams: TeamDTO[];
  teamLanes: Map<number, LaneSpec[]>;
  crossGroups: CrossGroup[];
  todayIndex: number;
  renderLane: (lane: LaneSpec, teamId: number | null) => React.ReactNode;
  renderTeamOverlay?: (teamId: number, height: number) => React.ReactNode;
  /** שכבה מעל הקוביות (סמנים קטנים כמו אבני דרך — כדי שלא יוסתרו ע"י קובייה באותו שבוע) */
  renderTeamMarkers?: (teamId: number, height: number) => React.ReactNode;
  renderCrossOverlay?: (kind: CrossGroup["kind"], height: number) => React.ReactNode;
  renderBodyOverlay?: (height: number) => React.ReactNode;
  /** שכבה "מולבשת" על כל בלוק תחום (מתחת לקוביות) — למשל ספרינטים של התחום. קואורדינטות: right = אינדקס שבוע × רוחב שבוע */
  renderDomainOverlay?: (domainId: number) => React.ReactNode;
  renderRowControl?: (lane: LaneSpec, teamId: number) => React.ReactNode;
  teamLabelExtra?: (teamId: number) => React.ReactNode;
  teamEditable: (teamId: number) => boolean;
  onLaneMouseDown?: (e: React.MouseEvent, lane: LaneSpec, teamId: number | null, weekIndex: number) => void;
  onLaneContextMenu?: (e: React.MouseEvent, lane: LaneSpec, teamId: number | null, weekIndex: number) => void;
  /** קליק ימני על שם תחום / צוות (למשל: הסתרה מהתצוגה) */
  onLabelContextMenu?: (e: React.MouseEvent, domainId: number, teamId: number | null) => void;
  emptyText?: React.ReactNode;
  /** הצגת סימון "צפייה בלבד" לצוותים ללא הרשאה (לא רלוונטי במצב השוואה) */
  readOnlyHints?: boolean;
};

export function weekIndexFromEvent(e: { clientX: number }, el: HTMLElement, weekW: number) {
  const r = el.getBoundingClientRect(); // קואורדינטות מסך (כולל הגדלת התצוגה) — לכן מחלקים ברוחב השבוע המוגדל
  return Math.floor((r.right - e.clientX) / (weekW * uiZoom()));
}

export const GanttGrid = memo(forwardRef<GanttGridHandle, Props>(function GanttGrid(p, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tip = useTooltip();
  const W = p.timeline.weeks.length * p.weekW;

  useImperativeHandle(ref, () => ({
    el: scrollRef.current,
    scrollToIndex: (idx: number, smooth = true) => { if (scrollRef.current) scrollTo(scrollRef.current, idx, smooth); },
  }), [p.weekW]); // eslint-disable-line react-hooks/exhaustive-deps
  /** גלילה כך שהשבוע idx יופיע בשליש הימני של המסך. RTL: scrollLeft שלילי ככל שמתקדמים שמאלה */
  function scrollTo(el: HTMLDivElement, idx: number, smooth: boolean) {
    const visible = el.clientWidth - LABEL_W;
    const target = Math.max(0, idx * p.weekW - visible / 3);
    el.scrollTo({ left: -target, behavior: smooth ? "smooth" : "auto" });
  }

  // סדר הצוותים לפי תחומים
  const blocks = p.domains
    .map((d) => ({ d, teams: p.teams.filter((t) => t.domainId === d.id).sort((a, b) => a.sortOrder - b.sortOrder) }))
    .filter((b) => b.teams.length > 0);

  const laneEvents = (lane: LaneSpec, teamId: number | null) => ({
    onMouseDown: p.onLaneMouseDown ? (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      p.onLaneMouseDown!(e, lane, teamId, weekIndexFromEvent(e, e.currentTarget, p.weekW));
    } : undefined,
    onContextMenu: p.onLaneContextMenu ? (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      p.onLaneContextMenu!(e, lane, teamId, weekIndexFromEvent(e, e.currentTarget, p.weekW));
    } : undefined,
  });

  const todayOk = p.todayIndex >= 0 && p.todayIndex < p.timeline.weeks.length;

  return (
    <div className="relative h-full w-full">
    <div ref={scrollRef} className="gantt-scroll relative h-full w-full overflow-auto bg-white" data-testid="gantt-scroll">
      <div style={{ width: LABEL_W + W, ["--week-w" as string]: `${p.weekW}px` }} className="relative">
        {/* ---------------- כותרות קפואות ---------------- */}
        <div className="sticky top-0 z-30 bg-white shadow-[0_1px_0_var(--line-strong)]">
          {/* שנה */}
          <div className="flex" style={{ height: YEAR_H }}>
            <div className="sticky right-0 z-10 flex shrink-0 items-center border-l border-b border-ink-200 bg-[var(--header)] px-1.5" style={{ width: LABEL_W }}>
              {todayOk && (
                <button className="flex h-[18px] items-center gap-1 rounded px-1.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
                  onClick={() => scrollRef.current && scrollTo(scrollRef.current, p.todayIndex, true)} data-testid="go-today" title="גלילה לשבוע הנוכחי">
                  <CalendarClock size={12} />חזרה להיום
                </button>
              )}
            </div>
            <div className="relative shrink-0 border-b border-ink-200 bg-[var(--header)]" style={{ width: W }}>
              {p.timeline.years.map((y) => (
                <div key={y.key} className="absolute top-0 flex h-full items-center border-l border-ink-300 px-2 text-[12px] font-bold text-ink-700"
                  style={{ right: y.startIndex * p.weekW, width: y.count * p.weekW }}>
                  <span className="sticky right-[248px]">{y.label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* חודש */}
          <div className="flex" style={{ height: MONTH_H }}>
            <div className="sticky right-0 z-10 shrink-0 border-l border-b border-ink-200 bg-[var(--header)]" style={{ width: LABEL_W }} />
            <div className="relative shrink-0 border-b border-ink-200 bg-[var(--header)]" style={{ width: W }}>
              {p.timeline.months.map((m) => (
                <div key={m.key} className="absolute top-0 flex h-full items-center justify-center overflow-hidden border-l border-ink-300 text-[12px] font-semibold text-ink-700"
                  style={{ right: m.startIndex * p.weekW, width: m.count * p.weekW }}>
                  <span className="truncate px-1">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* שבוע */}
          <div className="flex" style={{ height: WEEK_H }}>
            <div className="sticky right-0 z-10 flex shrink-0 items-center border-l border-b border-ink-200 bg-[var(--header)] text-[11px] font-semibold text-ink-500" style={{ width: LABEL_W }}>
              <span className="px-2" style={{ width: DOMAIN_W }}>תחום</span>
              <span className="px-2" style={{ width: TEAM_W }}>צוות</span>
            </div>
            <div className="relative shrink-0 border-b border-ink-200 bg-[var(--header)]" style={{ width: W }}>
              {p.timeline.weeks.map((w) => {
                const isToday = w.index === p.todayIndex;
                const monthStart = p.timeline.months.some((m) => m.startIndex === w.index);
                return (
                  <div key={w.start} data-week={w.start}
                    onMouseMove={(e) => tip.show(<div><div className="font-semibold">שבוע {w.num}{isToday ? " · השבוע הנוכחי" : ""}</div><div dir="ltr" className="text-right">{weekRangeLabel(w.start)}</div></div>, e)}
                    onMouseLeave={tip.hide}
                    className={clsx("absolute top-0 flex h-full items-center justify-center text-[11px] tabular-nums",
                      monthStart ? "border-l border-ink-200" : "border-l border-ink-100",
                      isToday ? "bg-brand-600 font-bold text-white" : "text-ink-500")}
                    style={{ right: w.index * p.weekW, width: p.weekW }}>
                    {w.num}
                    {isToday && p.weekW >= 40 && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-brand-700" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ---------------- גוף ---------------- */}
        <div className="relative" data-testid="gantt-body">
          {/* שורות רוחביות: גורמים משפיעים, מופעים רוחביים — בראש הגוף, נגללות עם התוכן (רק שנה/חודש/שבוע קבועים) */}
          {p.crossGroups.map((g) => {
            const h = g.lanes.reduce((s, l) => s + l.height, 0);
            return (
              <div key={g.kind} className="flex border-b border-ink-200" data-cross={g.kind}
                onContextMenu={p.onLabelContextMenu ? (e) => { if (!(e.target as HTMLElement).closest(".gantt-timeline")) { e.preventDefault(); p.onLabelContextMenu!(e, g.kind === "INFLUENCE" ? -1 : -2, null); } } : undefined}>
                <div className="sticky right-0 z-[28] flex shrink-0 items-center gap-1 border-l border-ink-200 bg-[#fbfcfe] px-2 text-[12px] font-semibold text-ink-700"
                  style={{ width: LABEL_W, height: h }}>
                  <span className="flex-1 truncate">{g.label}</span>
                  {!g.editable && p.readOnlyHints !== false && <span className="text-[10px] font-normal text-ink-400">צפייה בלבד</span>}
                </div>
                <div className={clsx("relative shrink-0 bg-[#fbfcfe]", !g.editable && p.readOnlyHints !== false && "readonly-hatch")} style={{ width: W, height: h }}>
                  {g.lanes.map((lane) => (
                    <div key={lane.key} data-lane-row={lane.rowId} data-lane-team="" data-editable={lane.editable ? "1" : "0"}
                      className="gantt-timeline relative" style={{ height: lane.height }} {...laneEvents(lane, null)}>
                      {p.renderLane(lane, null)}
                    </div>
                  ))}
                  {p.renderCrossOverlay?.(g.kind, h)}
                </div>
              </div>
            );
          })}
          {blocks.length === 0 && (
            <div className="sticky right-0 p-10 text-center text-ink-500" style={{ width: "min(100%, 100vw)" }}>{p.emptyText ?? "אין צוותים להצגה לפי הסינון הנוכחי"}</div>
          )}
          {blocks.map(({ d, teams }) => {
            const merged = d.isSingleTeam && teams.length === 1;
            return (
              <div key={d.id} className="relative flex border-b-2 border-ink-300" data-domain={d.id}>
                {!merged && (
                  <div className="sticky right-0 z-[28] shrink-0 border-l border-ink-200 bg-white" style={{ width: DOMAIN_W }} data-domain-label={d.id}
                    onContextMenu={p.onLabelContextMenu ? (e) => { e.preventDefault(); p.onLabelContextMenu!(e, d.id, null); } : undefined}>
                    <div className="sticky px-2 py-2 text-[13px] font-bold leading-tight text-ink-900" style={{ top: HEADER_H }}>{d.name}</div>
                  </div>
                )}
                <div className="flex flex-col">
                  {teams.map((t, ti) => {
                    const lanes = p.teamLanes.get(t.id) ?? [];
                    const lanesH = lanes.reduce((s, l) => s + l.height, 0);
                    const editable = p.teamEditable(t.id);
                    return (
                      <div key={t.id} className={clsx("flex", ti > 0 && "border-t border-ink-200")} data-team={t.id}>
                        <div className={clsx("group/team sticky z-[28] shrink-0 border-l border-ink-200 bg-white", merged ? "right-0" : "")}
                          style={{ width: merged ? DOMAIN_W + TEAM_W : TEAM_W, right: merged ? 0 : DOMAIN_W }} data-team-label={t.id}
                          onContextMenu={p.onLabelContextMenu ? (e) => { e.preventDefault(); p.onLabelContextMenu!(e, d.id, merged ? null : t.id); } : undefined}>
                          <div className="sticky flex items-start gap-1 px-2 py-2" style={{ top: HEADER_H }}>
                            <span className={clsx("flex-1 leading-tight", merged ? "text-[13px] font-bold text-ink-900" : "text-[12.5px] font-medium text-ink-700")}>{t.name}</span>
                            {p.teamLabelExtra?.(t.id)}
                          </div>
                          {!editable && p.readOnlyHints !== false && <div className="absolute bottom-1 right-2 text-[10px] text-ink-400">צפייה בלבד</div>}
                        </div>
                        <div className="relative flex flex-col">
                          {lanes.map((lane) => (
                            <div key={lane.key} className={clsx("flex", lane.isRowStart && lane.rowIndex > 0 && "border-t border-ink-100", lane.virtual && !lane.isRowStart && "border-t border-dashed border-ink-100")}>
                              <div className="group/row sticky z-[28] shrink-0 border-l border-ink-200 bg-white"
                                style={{ width: CTRL_W, right: DOMAIN_W + TEAM_W, height: lane.height }}>
                                {p.renderRowControl?.(lane, t.id)}
                              </div>
                              <div data-lane-row={lane.rowId} data-lane-team={t.id} data-editable={lane.editable ? "1" : "0"}
                                className={clsx("gantt-timeline relative shrink-0", !editable && p.readOnlyHints !== false && "readonly-hatch")}
                                style={{ width: W, height: lane.height }} {...laneEvents(lane, t.id)}>
                                {p.renderLane(lane, t.id)}
                              </div>
                            </div>
                          ))}
                          {p.renderTeamOverlay && (
                            <div className="pointer-events-none absolute top-0 z-[6]" style={{ right: CTRL_W, width: W, height: lanesH }}>
                              {p.renderTeamOverlay(t.id, lanesH)}
                            </div>
                          )}
                          {p.renderTeamMarkers && (
                            <div className="pointer-events-none absolute top-0 z-[15]" style={{ right: CTRL_W, width: W, height: lanesH }}>
                              {p.renderTeamMarkers(t.id, lanesH)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {p.renderDomainOverlay && (
                  <div className="pointer-events-none absolute inset-y-0 left-0 z-[3]" style={{ width: W }} data-domain-overlay={d.id}>
                    {p.renderDomainOverlay(d.id)}
                  </div>
                )}
              </div>
            );
          })}
          {/* עמודת השבוע הנוכחי וגבולות חודשים */}
          <BodyOverlay timeline={p.timeline} weekW={p.weekW} todayIndex={todayOk ? p.todayIndex : -1} />
          {p.renderBodyOverlay && (
            <div className="pointer-events-none absolute inset-y-0 z-[6]" style={{ right: LABEL_W, width: W }}>{p.renderBodyOverlay(0)}</div>
          )}
        </div>
      </div>
    </div>
    <ScrollArrows scrollRef={scrollRef} weekW={p.weekW} />
    </div>
  );
}));

/**
 * חיצי גלילה אופקית בצדי הגאנט. מוצגים רק כשיש לאן לגלול, ומחזיקים מצב משלהם (בלי לרנדר מחדש את הגאנט).
 * RTL: scrollLeft = 0 בקצה הימני (תחילת ציר הזמן) ושלילי שמאלה. החץ הימני ← מוקדם יותר, השמאלי ← מאוחר יותר.
 */
function ScrollArrows({ scrollRef, weekW }: { scrollRef: React.RefObject<HTMLDivElement | null>; weekW: number }) {
  const [can, setCan] = useState({ earlier: false, later: false });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { earlier: el.scrollLeft < -1, later: el.scrollLeft > -max + 1 };
      setCan((c) => (c.earlier === next.earlier && c.later === next.later ? c : next));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [scrollRef]);
  const step = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const visible = el.clientWidth - LABEL_W;
    const delta = Math.max(weekW * 4, Math.round((visible * 0.7) / weekW) * weekW); // ~70% מהמסך, מיושר לשבועות
    el.scrollBy({ left: dir * delta, behavior: "smooth" });
  };
  const btn = "gantt-arrow absolute top-1/2 z-[35] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-ink-200 bg-white/90 text-ink-600 shadow-pop backdrop-blur transition hover:bg-white hover:text-brand-700";
  return (
    <>
      {can.earlier && (
        <button className={btn} style={{ right: LABEL_W + 10 }} onClick={() => step(1)} aria-label="גלילה לתקופה מוקדמת יותר" title="מוקדם יותר" data-testid="scroll-earlier">
          <ChevronRight size={20} />
        </button>
      )}
      {can.later && (
        <button className={btn} style={{ left: 10 }} onClick={() => step(-1)} aria-label="גלילה לתקופה מאוחרת יותר" title="מאוחר יותר" data-testid="scroll-later">
          <ChevronLeft size={20} />
        </button>
      )}
    </>
  );
}

function BodyOverlay({ timeline, weekW, todayIndex }: { timeline: Timeline; weekW: number; todayIndex: number }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 z-[5]" style={{ right: LABEL_W, width: timeline.weeks.length * weekW }}>
      {timeline.months.map((m) => m.startIndex > 0 && (
        <div key={m.key} className="absolute inset-y-0 w-px bg-ink-200" style={{ right: m.startIndex * weekW }} />
      ))}
      {todayIndex >= 0 && (
        <div className="absolute inset-y-0 bg-[var(--today)]" style={{ right: todayIndex * weekW, width: weekW }}>
          <div className="absolute inset-y-0 right-0 w-px bg-brand-500/40" />
        </div>
      )}
    </div>
  );
}

/** השבוע הנוכחי (Asia/Jerusalem), נבדק מחדש כל דקה — הסימון מתעדכן מעצמו במעבר שבוע גם כשהדף פתוח */
export function useCurrentWeek(): ISODate {
  const [cw, setCw] = useState(() => currentWeekIL());
  useEffect(() => {
    const t = setInterval(() => setCw(currentWeekIL()), 60000);
    return () => clearInterval(t);
  }, []);
  return cw;
}
