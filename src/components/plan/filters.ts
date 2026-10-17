import type { ItemDTO, PlanData, TimeFilter, ViewConfig } from "@/lib/types";
import {
  addDays, addWeeks, currentWeekIL, monthRange, quarterRange, todayIL, weekStartOf, weekEndOf, periodWeeksWindow,
  daysDiff, HEB_MONTHS, fmtDate, type ISODate,
} from "@/lib/weeks";

/** השורות הרוחביות כ"תחומים" בסינון התחומים בגאנט (מזהים שליליים — לא מתנגשים בתחומים אמיתיים) */
export const CROSS_FILTER = { INFLUENCE: -1, CROSS_EVENT: -2 } as const;
export const CROSS_FILTER_IDS: number[] = [CROSS_FILTER.INFLUENCE, CROSS_FILTER.CROSS_EVENT];
export function crossRowVisible(v: ViewConfig, kind: "INFLUENCE" | "CROSS_EVENT") {
  return v.domainIds.length === 0 || v.domainIds.includes(CROSS_FILTER[kind]);
}

export function defaultViewConfig(prefs?: { showMilestones?: boolean; showSprints?: boolean; density?: ViewConfig["density"] }): ViewConfig {
  return {
    v: 2,
    domainIds: [], teamIds: [], statuses: [], priorities: [], search: "",
    time: { kind: "all" },
    showItems: true,
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
      // תמיד מציגים לפחות את השנה הנוכחית ואת השנה הבאה במלואן, גם אם עדיין אין בה תכולות
      let minY = y, maxY = y + 1;
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

// ---------------------------------------------------------------------------
// הסתרה / חשיפה מתוך המסך (קליק ימני על תחום/צוות, ואחרי הוספה)
// domainIds / teamIds הם רשימות "הכללה" — ריק = הכל.
// ---------------------------------------------------------------------------

/** הסתרת תחום מהתצוגה. null = לא ניתן (זה התחום האחרון שמוצג). */
export function hideDomain(v: ViewConfig, data: PlanData, domainId: number): ViewConfig | null {
  const shown = (v.domainIds.length ? v.domainIds : [...data.domains.map((d) => d.id), ...CROSS_FILTER_IDS]).filter((id) => id !== domainId);
  if (!shown.length) return null;
  const teamsOfDomain = new Set(data.teams.filter((t) => t.domainId === domainId).map((t) => t.id));
  return { ...v, domainIds: shown, teamIds: v.teamIds.filter((t) => !teamsOfDomain.has(t)) };
}

/** הצגת תחום אחד בלבד */
export function onlyDomain(v: ViewConfig, domainId: number): ViewConfig {
  return { ...v, domainIds: [domainId], teamIds: [] };
}

/** הסתרת צוות מהתצוגה. null = לא ניתן (זה הצוות האחרון שמוצג). */
export function hideTeam(v: ViewConfig, data: PlanData, teamId: number): ViewConfig | null {
  const visible = [...visibleTeamIds(data, v)].filter((id) => id !== teamId);
  if (!visible.length) return null;
  return { ...v, teamIds: visible };
}

/** סינון ברירת מחדל לפי הרשאות: משתמש עם עריכה לתחומים מסוימים רואה בהתחלה רק אותם */
export function permissionDefaultDomains(me: { role: string; domainIds: number[] }): number[] {
  // כולל את השורות הרוחביות — שהחגים ושאר המידע הרוחבי לא ייעלמו
  return me.role !== "SUPER" && me.domainIds.length ? [...me.domainIds, ...CROSS_FILTER_IDS] : [];
}

export type Revealable =
  | { kind: "item"; teamId: number | null; rowKind?: "TEAM" | "INFLUENCE" | "CROSS_EVENT"; status: string; priority: string; name: string; notes?: string; startWeek: ISODate; endWeek: ISODate }
  | { kind: "milestone"; teamId: number | null; domainId?: number | null; date: ISODate }
  | { kind: "sprint"; domainId: number; startDate: ISODate; endDate: ISODate };

/**
 * אחרי הוספה: אם הסינון הנוכחי מסתיר את מה שנוסף — פותחים את הסינון רק כמה שצריך כדי להציג אותו.
 * מחזיר את התצוגה החדשה (או null אם הכל כבר מוצג) ותיאור קצר של מה שהשתנה.
 */
export function revealFor(v: ViewConfig, data: PlanData, x: Revealable): { view: ViewConfig; changes: string[] } | null {
  let n = { ...v };
  const changes: string[] = [];
  const team = "teamId" in x && x.teamId !== null ? data.teams.find((t) => t.id === x.teamId) : undefined;
  const domainId = x.kind === "sprint" ? x.domainId : x.kind === "milestone" && x.domainId != null ? x.domainId : team?.domainId;
  if (domainId !== undefined && n.domainIds.length && !n.domainIds.includes(domainId)) { n.domainIds = [...n.domainIds, domainId]; changes.push("תחום"); }
  // תכולה רוחבית / אבן דרך רוחבית — השורה הרוחבית צריכה להיות מוצגת
  const crossKind = x.kind === "item" && x.rowKind && x.rowKind !== "TEAM" ? x.rowKind : x.kind === "milestone" && x.teamId === null && x.domainId == null ? "CROSS_EVENT" : null;
  if (crossKind && n.domainIds.length && !n.domainIds.includes(CROSS_FILTER[crossKind])) { n.domainIds = [...n.domainIds, CROSS_FILTER[crossKind]]; changes.push("שורה רוחבית"); }
  if (team && n.teamIds.length && !n.teamIds.includes(team.id)) { n.teamIds = [...n.teamIds, team.id]; changes.push("צוות"); }
  // ספרינט / אבן דרך של תחום שלם: לפחות צוות אחד מהתחום צריך להיות מוצג
  const wholeDomain = x.kind === "sprint" ? x.domainId : x.kind === "milestone" && x.domainId != null ? x.domainId : null;
  if (wholeDomain !== null && n.teamIds.length && !data.teams.some((t) => t.domainId === wholeDomain && n.teamIds.includes(t.id))) {
    n.teamIds = [...n.teamIds, ...data.teams.filter((t) => t.domainId === wholeDomain).map((t) => t.id)]; changes.push("צוות");
  }
  if (x.kind === "item") {
    if (n.showItems === false) { n.showItems = true; changes.push("תכולות"); }
    if (n.statuses.length && !n.statuses.includes(x.status)) { n.statuses = [...n.statuses, x.status]; changes.push("סטטוס"); }
    if (n.priorities.length && !n.priorities.includes(x.priority)) { n.priorities = [...n.priorities, x.priority]; changes.push("תיעדוף"); }
    const q = n.search.trim().toLowerCase();
    if (q && !x.name.toLowerCase().includes(q) && !(x.notes ?? "").toLowerCase().includes(q)) { n.search = ""; changes.push("חיפוש"); }
  }
  if (x.kind === "milestone" && !n.showMilestones) { n.showMilestones = true; changes.push("אבני דרך"); }
  if (x.kind === "sprint" && !n.showSprints) { n.showSprints = true; changes.push("ספרינטים"); }
  const [from, to] = x.kind === "item" ? [x.startWeek, x.endWeek] : x.kind === "milestone" ? [x.date, x.date] : [x.startDate, x.endDate];
  const [w0, w1] = timeWindow(n.time, data);
  if (to < w0 || from > w1) { n = { ...n, time: { kind: "all" } }; changes.push("טווח הזמן"); }
  return changes.length ? { view: n, changes: [...new Set(changes)] } : null;
}
