import type { ItemDTO, PlanData, TimeFilter, ViewConfig } from "@/lib/types";
import {
  addDays, addWeeks, currentWeekIL, monthRange, quarterRange, todayIL, weekStartOf, weekEndOf, periodWeeksWindow,
  daysDiff, HEB_MONTHS, fmtDate, type ISODate,
} from "@/lib/weeks";

export function defaultViewConfig(prefs?: { showMilestones?: boolean; showSprints?: boolean; density?: ViewConfig["density"] }): ViewConfig {
  return {
    domainIds: [], teamIds: [], statuses: [], priorities: [], search: "",
    time: { kind: "all" },
    showMilestones: prefs?.showMilestones ?? true,
    showSprints: prefs?.showSprints ?? false, // ספרינטים מוסתרים כברירת מחדל
    density: prefs?.density ?? "normal",
  };
}

/** חלון הזמן [from, to] בתאריכים קלנדריים */
export function timeWindow(t: TimeFilter, data?: PlanData): [ISODate, ISODate] {
  const today = todayIL();
  const y = Number(today.slice(0, 4));
  switch (t.kind) {
    case "currentWeek": { const s = currentWeekIL(); return [s, weekEndOf(s)]; }
    // תקופות קלנדריות מיושרות לכלל "שבוע שייך לחודש/שנה של יום ראשון שלו"
    case "currentMonth": return periodWeeksWindow(...monthRange(y, Number(today.slice(5, 7)) - 1));
    case "quarter": return periodWeeksWindow(...quarterRange(t.year, t.q));
    case "year": return periodWeeksWindow(`${t.year}-01-01`, `${t.year}-12-31`);
    case "dates": return t.from <= t.to ? [t.from, t.to] : [t.to, t.from];
    case "all": {
      let minY = y, maxY = y;
      for (const i of data?.items ?? []) {
        minY = Math.min(minY, Number(i.startWeek.slice(0, 4)));
        maxY = Math.max(maxY, Number(i.endWeek.slice(0, 4)));
      }
      for (const m of data?.milestones ?? []) {
        minY = Math.min(minY, Number(m.date.slice(0, 4)));
        maxY = Math.max(maxY, Number(m.date.slice(0, 4)));
      }
      return [`${minY}-01-01`, `${maxY}-12-31`];
    }
  }
}

/** הזזת חלון הזמן קדימה/אחורה באותו אורך תקופה */
export function shiftTime(t: TimeFilter, dir: 1 | -1): TimeFilter {
  const today = todayIL();
  switch (t.kind) {
    case "all": return t;
    case "year": return { kind: "year", year: t.year + dir };
    case "quarter": {
      let q = t.q + dir, year = t.year;
      if (q === 0) { q = 4; year--; } if (q === 5) { q = 1; year++; }
      return { kind: "quarter", year, q };
    }
    case "currentWeek": { const s = addWeeks(currentWeekIL(), dir); return { kind: "dates", from: s, to: weekEndOf(s) }; }
    case "currentMonth": {
      let m = Number(today.slice(5, 7)) - 1 + dir, yy = Number(today.slice(0, 4));
      if (m < 0) { m = 11; yy--; } if (m > 11) { m = 0; yy++; }
      const [from, to] = monthRange(yy, m); return { kind: "dates", from, to };
    }
    case "dates": {
      const [f, to0] = t.from <= t.to ? [t.from, t.to] : [t.to, t.from];
      // טווח של N חודשים שלמים → N החודשים הבאים/הקודמים
      if (f.endsWith("-01") && addDays(to0, 1).endsWith("-01")) {
        const mi = (s: ISODate) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
        const n = mi(to0) - mi(f) + 1;
        const a = mi(f) + dir * n, b = a + n - 1;
        return { kind: "dates", from: monthRange(Math.floor(a / 12), a % 12)[0], to: monthRange(Math.floor(b / 12), b % 12)[1] };
      }
      const len = daysDiff(f, to0) + 1; // הזזה באורך הטווח המדויק — ללא חפיפות וללא פערים
      return { kind: "dates", from: addDays(f, dir * len), to: addDays(to0, dir * len) };
    }
  }
}

export function timeLabel(t: TimeFilter): string {
  switch (t.kind) {
    case "all": return "כל התקופה";
    case "currentWeek": return "השבוע הנוכחי";
    case "currentMonth": return "החודש הנוכחי";
    case "quarter": return `Q${t.q} ${t.year}`;
    case "year": return `שנת ${t.year}`;
    case "dates": {
      if (t.from.endsWith("-01") && addDays(t.to, 1).endsWith("-01") && t.from.slice(0, 7) === t.to.slice(0, 7)) {
        return `${HEB_MONTHS[Number(t.from.slice(5, 7)) - 1]} ${t.from.slice(0, 4)}`;
      }
      return `${fmtDate(t.from)} – ${fmtDate(t.to)}`;
    }
  }
}

/** האם תכולה עומדת במסננים (תוכן בלבד; צוותים מסוננים ברמת המבנה) */
export function itemMatches(i: ItemDTO, v: ViewConfig, window?: [ISODate, ISODate]): boolean {
  if (v.statuses.length && !v.statuses.includes(i.status)) return false;
  if (v.priorities.length && !v.priorities.includes(i.priority)) return false;
  if (v.search.trim()) {
    const q = v.search.trim().toLowerCase();
    if (!i.name.toLowerCase().includes(q) && !i.notes.toLowerCase().includes(q) && String(i.id) !== q) return false;
  }
  if (window) {
    const ws = weekStartOf(window[0]);
    if (i.endWeek < ws || i.startWeek > window[1]) return false;
  }
  return true;
}

export function hasContentFilter(v: ViewConfig) {
  return v.statuses.length > 0 || v.priorities.length > 0 || v.search.trim().length > 0;
}

/** צוותים מוצגים לפי סינון תחומים/צוותים */
export function visibleTeamIds(data: PlanData, v: ViewConfig): Set<number> {
  return new Set(data.teams.filter((t) =>
    (v.domainIds.length === 0 || v.domainIds.includes(t.domainId)) &&
    (v.teamIds.length === 0 || v.teamIds.includes(t.id))).map((t) => t.id));
}
