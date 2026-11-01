// עזרים טהורים לשרת ה-MCP: פענוח שבועות ותאריכים כפי שעוזר AI כותב אותם, ועיצוב התשובות.
import type { Catalog } from "./catalog";
import type { ItemDTO, PlanData } from "./types";
import { CROSS_ROW_LABELS } from "./constants";
import { addDays, isISODate, sundayOfWeekNumber, weekEndOf, weekNumber, weekStartOf, weekYear, type ISODate } from "./weeks";

/**
 * שבוע מתוך קלט חופשי: תאריך YYYY-MM-DD (כל יום בשבוע → יום ראשון שלו), או מספר שבוע בארגון:
 * "12/2026", "W12/2026", "2026-W12", "week 12 2026", "שבוע 12 2026".
 */
export function parseWeek(input: string): ISODate {
  const s = input.trim();
  if (isDate(s)) return weekStartOf(s);
  const m = s.match(/^(?:w|week|שבוע)?\s*(\d{1,2})\s*[/\s,.-]\s*(\d{4})$/i) ?? null;
  const m2 = s.match(/^(\d{4})\s*-?\s*w\s*(\d{1,2})$/i);
  const [num, year] = m ? [Number(m[1]), Number(m[2])] : m2 ? [Number(m2[2]), Number(m2[1])] : [NaN, NaN];
  if (!Number.isInteger(num) || num < 1 || num > 53 || year < 2000 || year > 2100) {
    throw new Error(`לא הצלחתי לפענח שבוע: "${input}". השתמש בתאריך YYYY-MM-DD או במספר שבוע בפורמט N/YYYY (למשל 12/2026).`);
  }
  const sunday = sundayOfWeekNumber(year, num);
  if (weekYear(sunday) !== year) throw new Error(`בשנת ${year} אין שבוע ${num}.`);
  return sunday;
}

// isISODate הוא Type guard ל-string — עטיפה כדי שלא "יצמצם" את המחרוזת ל-never בענף השלילי
const isDate = (s: string): boolean => isISODate(s);

/** תאריך מתוך קלט: YYYY-MM-DD בלבד (לאבני דרך ולספרינטים) */
export function parseDate(input: string): ISODate {
  const s = input.trim();
  if (!isDate(s)) throw new Error(`תאריך לא תקין: "${input}" (נדרש YYYY-MM-DD).`);
  return s;
}

export const weekTag = (sunday: ISODate) => `${weekNumber(sunday)}/${weekYear(sunday)}`;

export function weekInfo(sunday: ISODate) {
  return { week: weekTag(sunday), sunday, saturday: weekEndOf(sunday) };
}

/** מיקום של תכולה בתוכנית: תחום / צוות, או שורה רוחבית */
export function placeOf(data: PlanData, i: Pick<ItemDTO, "rowId" | "teamId">) {
  if (i.teamId === null) {
    const kind = data.rows.find((r) => r.id === i.rowId)?.kind;
    return { domain: null, team: null, cross: kind && kind !== "TEAM" ? CROSS_ROW_LABELS[kind] : "רוחבי" };
  }
  const t = data.teams.find((x) => x.id === i.teamId);
  const d = data.domains.find((x) => x.id === t?.domainId);
  return { domain: d ? { id: d.id, name: d.name } : null, team: t ? { id: t.id, name: t.name } : null, cross: null };
}

export function itemOut(data: PlanData, cat: Catalog, i: ItemDTO, appUrl?: string) {
  const p = placeOf(data, i);
  return {
    id: i.id,
    name: i.name,
    ...(p.cross ? { cross_row: p.cross } : { domain: p.domain?.name, domain_id: p.domain?.id, team: p.team?.name, team_id: p.team?.id }),
    status: cat.status(i.status).label, status_key: i.status,
    priority: cat.priority(i.priority).label, priority_key: i.priority,
    start_week: weekTag(i.startWeek), end_week: weekTag(i.endWeek),
    start_date: i.startWeek, end_date: addDays(i.endWeek, 6),
    weeks: Math.round((Date.parse(i.endWeek) - Date.parse(i.startWeek)) / 604800000) + 1,
    ...(i.notes ? { notes: i.notes } : {}),
    ...(i.dependencies?.length ? { dependencies: i.dependencies.map((d) => ({ text: d.text, on: d.on || undefined, done: d.done })) } : {}),
    updated_by: data.users.find((u) => u.id === i.updatedById)?.fullName,
    updated_at: i.updatedAt,
    ...(appUrl ? { link: `${appUrl}/plan?view=gantt&locate=${i.id}` } : {}),
  };
}

/** האם תכולה חופפת לטווח [from, to] (ימי ראשון) */
export function overlaps(i: Pick<ItemDTO, "startWeek" | "endWeek">, from?: ISODate, to?: ISODate) {
  return !(from && i.endWeek < from) && !(to && i.startWeek > to);
}
