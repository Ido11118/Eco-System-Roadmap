import type { ViewConfig } from "@/lib/types";

export const CTRL_W = 20; // עמודת כפתורי השורה (רוחב עמודות התחום/הצוות — אישי, ראה GANTT_COLS ב-prefs)
export const YEAR_H = 22;
export const MONTH_H = 22;
export const WEEK_H = 26;
export const HEADER_H = YEAR_H + MONTH_H + WEEK_H;

/** mobile: בטלפון שבועות צרים יותר (רואים יותר זמן), ושורות לא נמוכות מ-30px — נוח להקשה באצבע */
export function geometry(density: ViewConfig["density"], compare = false, mobile = false) {
  let weekW = density === "compact" ? 30 : density === "wide" ? 64 : 42;
  let rowH = density === "compact" ? 26 : density === "wide" ? 38 : 32;
  if (mobile) { weekW = Math.min(weekW, 34); rowH = Math.max(rowH, 30); }
  return { weekW, rowH: compare ? rowH + 12 : rowH, crossLaneH: density === "compact" ? 22 : 26 };
}
