// תיקון חד-פעמי למספור השבועות (10/2026).
// עד התיקון שבוע 1 הוגדר כ"השבוע שמתחיל ביום ראשון הראשון של השנה" (ב-2026: 04/01), אבל בארגון שבוע 1 הוא
// השבוע שבו חל ה-1 בינואר (ב-2026: 28/12/2025). המשתמשים הזינו תכולות לפי מספרי השבוע שהוצגו —
// ולכן כדי שכל תכולה תישאר באותו מספר שבוע, מזיזים את התאריך שלה ליום ראשון של אותו מספר במספור הנכון.
import { addDays, dayOfWeek, sundayOfWeekNumber, weeksDiff, weekStartOf, type ISODate } from "./weeks";

/** יום ראשון הראשון של השנה — הכלל הישן (השגוי) לשבוע 1 */
function legacyFirstSunday(year: number): ISODate {
  const jan1 = `${year}-01-01`;
  const dow = dayOfWeek(jan1);
  return addDays(jan1, dow === 0 ? 0 : 7 - dow);
}

/** המספר שהוצג לפי הכלל הישן: שנת יום ראשון + מספר מיום ראשון הראשון של אותה שנה */
export function legacyWeekNumber(sunday: ISODate): { year: number; num: number } {
  const year = Number(sunday.slice(0, 4));
  return { year, num: weeksDiff(legacyFirstSunday(year), sunday) + 1 };
}

/**
 * יום ראשון שנשמר לפי המספור הישן → יום ראשון של אותו מספר שבוע במספור הנכון.
 * בשנה שה-1 בינואר שלה אינו יום ראשון (2025–2028) — שבוע אחד אחורה; בשנה שמתחילה ביום ראשון — ללא שינוי.
 */
export function remapLegacyWeek(sunday: ISODate): ISODate {
  const { year, num } = legacyWeekNumber(sunday);
  return sundayOfWeekNumber(year, num);
}

/** תאריך כלשהו (אבן דרך, תחילת/סוף ספרינט) → אותו יום בשבוע, באותו מספר שבוע במספור הנכון */
export function remapLegacyDate(date: ISODate): ISODate {
  const sunday = weekStartOf(date);
  return addDays(remapLegacyWeek(sunday), dayOfWeek(date));
}
