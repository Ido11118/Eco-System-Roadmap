import type { ViewConfig } from "@/lib/types";

export const CTRL_W = 20; // עמודת כפתורי השורה (רוחב עמודות התחום/הצוות — אישי, ראה GANTT_COLS ב-prefs)
export const YEAR_H = 22;
export const MONTH_H = 22;
export const WEEK_H = 26;
export const HEADER_H = YEAR_H + MONTH_H + WEEK_H;

/** האם קובייה בגובה הזה מכילה שתי שורות טקסט בגודל המלל הנבחר (ואז שם ארוך גולש לשורה שנייה במקום "…") */
export const fitsTwoLines = (barH: number, fontPx: number) => barH >= Math.ceil(fontPx * 1.2) * 2 + 4;

/** הרוחב/הגובה לפי הצפיפות בלבד (ערכי ברירת המחדל של ההגדרות המתקדמות) */
export function densityGeometry(density: ViewConfig["density"]) {
  return { weekW: density === "compact" ? 30 : density === "wide" ? 64 : 42, rowH: density === "compact" ? 26 : density === "wide" ? 38 : 32 };
}

/**
 * mobile: בטלפון שבועות צרים יותר (רואים יותר זמן), ושורות לא נמוכות מ-30px — נוח להקשה באצבע.
 * custom: הגדרות תצוגה מתקדמות של המשתמש (רוחב שבוע / גובה שורה) — גוברות על הצפיפות ועל ברירות המחדל בטלפון.
 */
export function geometry(density: ViewConfig["density"], compare = false, mobile = false, custom?: { weekW?: number; rowH?: number }) {
  let { weekW, rowH } = densityGeometry(density);
  if (mobile) { weekW = Math.min(weekW, 34); rowH = Math.max(rowH, 30); }
  if (custom?.weekW) weekW = custom.weekW;
  if (custom?.rowH) rowH = custom.rowH;
  return { weekW, rowH: compare ? rowH + 12 : rowH, crossLaneH: density === "compact" ? 22 : 26 };
}
