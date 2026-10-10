// חישובי שבועות ותאריכים.
// הגדרות (קבועות בכל המערכת):
// - שבוע = ראשון עד שבת.
// - שבוע מזוהה לפי תאריך יום ראשון שלו (YYYY-MM-DD).
// - שבוע משויך לחודש ולשנה שבהם חל יום ראשון שלו.
// - מספר שבוע = מספר סידורי בתוך שנת יום-הראשון: שבוע 1 הוא השבוע שיום ראשון שלו הוא יום הראשון הראשון בשנה.
// כל החישובים נעשים על תאריכים קלנדריים "טהורים" (UTC midnight) כדי להימנע מבעיות שעון קיץ ואזורי זמן.

export type ISODate = string; // YYYY-MM-DD

export const TIMEZONE = "Asia/Jerusalem";
const DAY = 86400000;

export const HEB_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISO(parseISO(s)) === s;
}

export function addDays(s: ISODate, n: number): ISODate {
  return toISO(new Date(parseISO(s).getTime() + n * DAY));
}

export function addWeeks(s: ISODate, n: number): ISODate {
  return addDays(s, n * 7);
}

export function dayOfWeek(s: ISODate): number {
  return parseISO(s).getUTCDay(); // 0 = ראשון
}

export function isSunday(s: ISODate): boolean {
  return dayOfWeek(s) === 0;
}

/** יום ראשון של השבוע שבו חל התאריך */
export function weekStartOf(s: ISODate): ISODate {
  return addDays(s, -dayOfWeek(s));
}

/** שבת של השבוע שמתחיל ב-sunday */
export function weekEndOf(sunday: ISODate): ISODate {
  return addDays(weekStartOf(sunday), 6);
}

/** מספר השבועות מ-a ל-b (b - a), שניהם ימי ראשון */
export function weeksDiff(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / (7 * DAY));
}

export function daysDiff(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY);
}

/** התאריך של היום באזור הזמן של ישראל */
export function todayIL(now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function currentWeekIL(now: Date = new Date()): ISODate {
  return weekStartOf(todayIL(now));
}

export function firstSundayOfYear(year: number): ISODate {
  const jan1 = `${year}-01-01`;
  const dow = dayOfWeek(jan1);
  return addDays(jan1, dow === 0 ? 0 : 7 - dow);
}

export function weekYear(sunday: ISODate): number {
  return Number(sunday.slice(0, 4));
}

export function weekMonth(sunday: ISODate): number {
  return Number(sunday.slice(5, 7)) - 1; // 0-11
}

export function weekNumber(sunday: ISODate): number {
  const y = weekYear(sunday);
  return weeksDiff(firstSundayOfYear(y), sunday) + 1;
}

/** המרת (שנה, מספר שבוע) לתאריך יום ראשון */
export function sundayOfWeekNumber(year: number, num: number): ISODate {
  return addWeeks(firstSundayOfYear(year), num - 1);
}

export function fmtDate(s: ISODate): string {
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

export function fmtShort(s: ISODate): string {
  return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
}

export function weekRangeLabel(sunday: ISODate): string {
  return `${fmtDate(sunday)}–${fmtDate(weekEndOf(sunday))}`;
}

export function weekLabel(sunday: ISODate): string {
  return `שבוע ${weekNumber(sunday)} (${weekYear(sunday)})`;
}

export type TimelineWeek = {
  index: number;
  start: ISODate;
  end: ISODate;
  num: number;
  year: number;
  month: number;
};

export type TimelineGroup = { key: string; label: string; startIndex: number; count: number };

export type Timeline = {
  weeks: TimelineWeek[];
  years: TimelineGroup[];
  months: TimelineGroup[];
  first: ISODate;
  last: ISODate;
  indexOf: (sunday: ISODate) => number; // יכול להיות מחוץ לטווח (שלילי / >= length)
};

/** בניית ציר זמן של שבועות רציפים בין שני תאריכים (כולל) */
export function buildTimeline(from: ISODate, to: ISODate): Timeline {
  const first = weekStartOf(from);
  const last = weekStartOf(to);
  const weeks: TimelineWeek[] = [];
  for (let s = first, i = 0; s <= last; s = addWeeks(s, 1), i++) {
    weeks.push({ index: i, start: s, end: weekEndOf(s), num: weekNumber(s), year: weekYear(s), month: weekMonth(s) });
  }
  const years: TimelineGroup[] = [];
  const months: TimelineGroup[] = [];
  for (const w of weeks) {
    const yk = String(w.year);
    const mk = `${w.year}-${w.month}`;
    const ly = years[years.length - 1];
    if (ly && ly.key === yk) ly.count++;
    else years.push({ key: yk, label: yk, startIndex: w.index, count: 1 });
    const lm = months[months.length - 1];
    if (lm && lm.key === mk) lm.count++;
    else months.push({ key: mk, label: HEB_MONTHS[w.month], startIndex: w.index, count: 1 });
  }
  return { weeks, years, months, first, last, indexOf: (s) => weeksDiff(first, weekStartOf(s)) };
}

/** טווחי זמן מוכנים לסינון */
export function quarterRange(year: number, q: number): [ISODate, ISODate] {
  const m0 = (q - 1) * 3;
  const start = `${year}-${String(m0 + 1).padStart(2, "0")}-01`;
  const endMonthFirst = q === 4 ? `${year + 1}-01-01` : `${year}-${String(m0 + 4).padStart(2, "0")}-01`;
  return [start, addDays(endMonthFirst, -1)];
}

export function monthRange(year: number, month0: number): [ISODate, ISODate] {
  const start = `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
  const next = month0 === 11 ? `${year + 1}-01-01` : `${year}-${String(month0 + 2).padStart(2, "0")}-01`;
  return [start, addDays(next, -1)];
}

/** השבועות (ימי ראשון) שמשויכים לטווח תאריכים לפי כלל "יום ראשון". null אם אין בטווח אף יום ראשון. */
export function sundaysInRange(from: ISODate, to: ISODate): [ISODate, ISODate] | null {
  const s = isSunday(from) ? from : addDays(weekStartOf(from), 7);
  const e = weekStartOf(to);
  return e < s ? null : [s, e];
}

/** חלון תאריכים של תקופה קלנדרית (חודש/רבעון/שנה) מיושר לשבועות המשויכים אליה: מיום ראשון הראשון ועד שבת האחרונה */
export function periodWeeksWindow(from: ISODate, to: ISODate): [ISODate, ISODate] {
  const r = sundaysInRange(from, to);
  if (!r) { const s = weekStartOf(from); return [s, weekEndOf(s)]; }
  return [r[0], weekEndOf(r[1])];
}

export function quarterOf(s: ISODate): number {
  return Math.floor(weekMonth(s) / 3) + 1;
}
