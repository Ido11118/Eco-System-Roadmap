// מודל הייצוא של הגאנט (Excel / PDF): לוגיקה טהורה, ללא תלות בדפדפן.
// מקבל את נתוני התוכנית, הסינון הנוכחי של המשתמש והגדרות הייצוא — ומחזיר מבנה מוכן לציור:
// שורות רוחביות → תחומים → צוותים → נתיבים (שורות עבודה), ואבני דרך / ספרינטים לפי בחירה.
import type { DomainDTO, ItemDTO, MilestoneDTO, PlanData, SprintDTO, TeamDTO, ViewConfig } from "@/lib/types";
import { CROSS_ROW_LABELS } from "@/lib/constants";
import { layoutLanes } from "@/lib/compare";
import { CROSS_FILTER, CROSS_FILTER_IDS, itemMatches, timeWindow } from "@/components/plan/filters";
import { buildTimeline, weekEndOf, weekNumber, weekStartOf, weekYear, type ISODate, type Timeline } from "@/lib/weeks";

export type ExportFormat = "xlsx" | "pdf";
export type PageSize = "a4" | "a3";

export type ExportOptions = {
  /** שבוע ראשון ושבוע אחרון (ימי ראשון), כולל */
  from: ISODate;
  to: ISODate;
  /** תחומים לייצוא: מזהי תחומים + המזהים השליליים של השורות הרוחביות (CROSS_FILTER) */
  domainIds: number[];
  milestones: boolean;
  sprints: boolean;
};

export type CrossKind = "INFLUENCE" | "CROSS_EVENT";
export type ExportCross = { kind: CrossKind; label: string; lanes: ItemDTO[][]; milestones: MilestoneDTO[] };
export type ExportTeam = { team: TeamDTO; lanes: ItemDTO[][]; milestones: MilestoneDTO[] };
export type ExportDomain = {
  domain: DomainDTO;
  /** תחום של צוות יחיד ששמו כשם התחום — מוצג בתא ממוזג אחד (כמו במסך) */
  merged: boolean;
  teams: ExportTeam[];
  /** ספרינטי התחום, מפוזרים לנתיבים כך שספרינטים חופפים לא יתנגשו */
  sprintLanes: SprintDTO[][];
  /** אבני דרך של התחום כולו (לא של צוות מסוים) */
  milestones: MilestoneDTO[];
};
/** שורת טבלה: תכולה עם מיקומה בתוכנית */
export type ExportItemRow = { item: ItemDTO; domain: string; team: string };

export type ExportModel = {
  timeline: Timeline;
  cross: ExportCross[];
  domains: ExportDomain[];
  rows: ExportItemRow[];
  milestones: MilestoneDTO[];
  sprints: SprintDTO[];
};

/** ברירת המחדל לטווח: כל הגאנט (כמו "כל התקופה" בסינון הזמן) */
export function fullRange(data: PlanData): [ISODate, ISODate] {
  const [a, b] = timeWindow({ kind: "all" }, data);
  return [weekStartOf(a), weekStartOf(b)];
}

/** ברירת המחדל לתחומים: מה שמוצג כרגע בסינון (ריק = הכל) */
export function defaultDomainIds(data: PlanData, view: ViewConfig): number[] {
  const all = [...CROSS_FILTER_IDS, ...data.domains.map((d) => d.id)];
  return view.domainIds.length ? all.filter((id) => view.domainIds.includes(id)) : all;
}

export function weekTag(sunday: ISODate): string {
  return `${weekNumber(sunday)}/${weekYear(sunday)}`;
}

const bySort = <T extends { sortOrder: number; id: number }>(a: T, b: T) => a.sortOrder - b.sortOrder || a.id - b.id;

export function buildExportModel(data: PlanData, view: ViewConfig, opt: ExportOptions): ExportModel {
  const from = weekStartOf(opt.from <= opt.to ? opt.from : opt.to);
  const to = weekStartOf(opt.from <= opt.to ? opt.to : opt.from);
  const timeline = buildTimeline(from, to);
  const win: [ISODate, ISODate] = [from, weekEndOf(to)];
  const sel = new Set(opt.domainIds);
  // כל המסננים הפעילים חלים גם על הייצוא (סטטוס, תיעדוף, חיפוש) — ובנוסף חלון השבועות שנבחר
  const matches = (i: ItemDTO) => itemMatches(i, view, win);
  const inWin = (a: ISODate, b: ISODate) => !(b < win[0] || a > win[1]);

  const itemsByRow = new Map<number, ItemDTO[]>();
  for (const i of data.items) if (matches(i)) {
    if (!itemsByRow.has(i.rowId)) itemsByRow.set(i.rowId, []);
    itemsByRow.get(i.rowId)!.push(i);
  }
  for (const arr of itemsByRow.values()) arr.sort((a, b) => a.startWeek.localeCompare(b.startWeek) || a.id - b.id);

  const ms = opt.milestones ? data.milestones.filter((m) => inWin(m.date, m.date)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id) : [];
  const rows: ExportItemRow[] = [];

  // ---------- שורות רוחביות ----------
  const cross: ExportCross[] = [];
  for (const kind of ["INFLUENCE", "CROSS_EVENT"] as const) {
    if (!sel.has(CROSS_FILTER[kind])) continue;
    const rowIds = data.rows.filter((r) => r.kind === kind).sort(bySort).map((r) => r.id);
    const items = rowIds.flatMap((id) => itemsByRow.get(id) ?? []);
    // חפיפה מותרת בשורות הרוחביות → פריסה לנתיבים (כמו במסך)
    const lanes = layoutLanes(items, rowIds, (i) => i.rowId,
      (i) => [[timeline.indexOf(i.startWeek), timeline.indexOf(i.endWeek)]], (i) => i.id).map((l) => l.units);
    const label = CROSS_ROW_LABELS[kind];
    cross.push({
      kind, label, lanes: lanes.length ? lanes : [[]],
      milestones: kind === "CROSS_EVENT" ? ms.filter((m) => m.teamId === null && m.domainId === null) : [],
    });
    for (const i of items) rows.push({ item: i, domain: label, team: "" });
  }

  // ---------- תחומים וצוותים ----------
  // סינון הצוותים של המשתמש חל בתוך כל תחום שיש בו צוותים מסוננים; תחום שנוסף בחלון הייצוא ואין בו צוות מסונן — מיוצא במלואו
  const teamFilter = new Set(view.teamIds.filter((id) => data.teams.some((t) => t.id === id)));
  const rowsByTeam = new Map<number, number[]>();
  for (const r of [...data.rows].sort(bySort)) if (r.kind === "TEAM" && r.teamId !== null) {
    if (!rowsByTeam.has(r.teamId)) rowsByTeam.set(r.teamId, []);
    rowsByTeam.get(r.teamId)!.push(r.id);
  }
  const domains: ExportDomain[] = [];
  for (const d of [...data.domains].sort(bySort)) {
    if (!sel.has(d.id)) continue;
    const all = data.teams.filter((t) => t.domainId === d.id).sort(bySort);
    const filtered = all.some((t) => teamFilter.has(t.id)) ? all.filter((t) => teamFilter.has(t.id)) : all;
    if (!filtered.length) continue;
    const teams: ExportTeam[] = filtered.map((t) => {
      // שורות ריקות לא נכנסות לייצוא; צוות ללא תכולות בטווח נשאר עם נתיב ריק אחד, כדי שהמבנה יישמר
      const lanes = (rowsByTeam.get(t.id) ?? []).map((rid) => itemsByRow.get(rid) ?? []).filter((l) => l.length);
      for (const l of lanes) for (const i of l) rows.push({ item: i, domain: d.name, team: t.name });
      return { team: t, lanes: lanes.length ? lanes : [[]], milestones: ms.filter((m) => m.teamId === t.id) };
    });
    const sprints = opt.sprints
      ? data.sprints.filter((s) => s.domainId === d.id && inWin(s.startDate, s.endDate)).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id)
      : [];
    const sprintLanes = layoutLanes(sprints, [0], () => 0,
      (s) => [[timeline.indexOf(weekStartOf(s.startDate)), timeline.indexOf(weekStartOf(s.endDate))]], (s) => s.id).map((l) => l.units).filter((l) => l.length);
    domains.push({
      domain: d, merged: d.isSingleTeam && teams.length === 1 && all.length === 1, teams, sprintLanes,
      milestones: ms.filter((m) => m.teamId === null && m.domainId === d.id),
    });
  }

  const shownTeams = new Set(domains.flatMap((d) => d.teams.map((t) => t.team.id)));
  const shownDomains = new Set(domains.map((d) => d.domain.id));
  const milestones = ms.filter((m) => m.teamId !== null ? shownTeams.has(m.teamId)
    : m.domainId !== null ? shownDomains.has(m.domainId) : sel.has(CROSS_FILTER.CROSS_EVENT));
  const sprints = domains.flatMap((d) => d.sprintLanes.flat()).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
  return { timeline, cross, domains, rows, milestones, sprints };
}

/** שם קובץ בטוח: "תוכנית עבודה - <מקור> - <תאריך>.<סיומת>" */
export function exportFileName(ext: ExportFormat, today: ISODate, source?: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `${clean(["תוכנית עבודה", source, today].filter(Boolean).join(" - "))}.${ext}`;
}
