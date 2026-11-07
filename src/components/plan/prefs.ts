"use client";
// העדפות אישיות בצד הלקוח: מטמון אחד לכל המסכים (כדי שמעבר בין תצוגות לא יחזיר ערכים ישנים)
// והשמירה בשרת היא מיזוג אטומי של השדות שהשתנו בלבד.
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import type { UserPreferences, ViewConfig, ViewDisplay, PlanData, TextSize } from "@/lib/types";
import { CROSS_FILTER_IDS, defaultViewConfig } from "./filters";

let cache: UserPreferences | null = null;

export function currentPrefs(initial: UserPreferences): UserPreferences {
  // בשרת (SSR) המודול משותף לכל המשתמשים — אסור לשמור בו מטמון, אחרת העדפות של משתמש אחד ידלפו לאחר
  if (typeof window === "undefined") return initial;
  if (!cache) cache = { ...initial };
  return cache;
}

const listeners = new Set<() => void>();

export function savePrefs(patch: Partial<UserPreferences>) {
  cache = { ...(cache ?? {}), ...patch };
  listeners.forEach((l) => l());
  void api("PATCH", "/api/me/preferences", patch).catch(() => {});
}

/** גודל התצוגה האישי — הממשק מתעדכן מיד בכל שינוי */
export const TEXT_SIZES: { key: TextSize; label: string; zoom: number }[] = [
  { key: "sm", label: "קטן", zoom: 0.9 },
  { key: "md", label: "רגיל", zoom: 1 },
  { key: "lg", label: "גדול", zoom: 1.12 },
  { key: "xl", label: "גדול מאוד", zoom: 1.25 },
];
export function zoomOf(size: TextSize | undefined) {
  return TEXT_SIZES.find((t) => t.key === size)?.zoom ?? 1;
}
/** מקדם ההגדלה הנוכחי — לחישובי מיקום עכבר בגאנט ובטבלה (קואורדינטות המסך מוגדלות, המידות הפנימיות לא) */
export function uiZoom(): number {
  return typeof window === "undefined" ? 1 : zoomOf(cache?.textSize);
}
/** גודל הטקסט בתוך קוביות הגאנט — נשמר אישית ומתעדכן מיד בכל המסכים */
export const BAR_FONT = { min: 10, max: 20, def: 12 };
export function useBarFontSize(initial: UserPreferences): [number, (n: number) => void] {
  const [v, setV] = useState<number>(() => Math.max(BAR_FONT.min, currentPrefs(initial).barFontSize ?? BAR_FONT.def));
  useEffect(() => {
    const l = () => setV(Math.max(BAR_FONT.min, cache?.barFontSize ?? BAR_FONT.def));
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [v, (n) => savePrefs({ barFontSize: n })];
}

export function useFitBarText(initial: UserPreferences): [boolean, (enabled: boolean) => void] {
  const [v, setV] = useState(() => currentPrefs(initial).fitBarText ?? false);
  useEffect(() => {
    const listener = () => setV(cache?.fitBarText ?? false);
    listeners.add(listener); return () => { listeners.delete(listener); };
  }, []);
  return [v, (fitBarText) => savePrefs({ fitBarText })];
}

/** הגדרות תצוגה מתקדמות: רוחב עמודת שבוע וגובה שורה בגאנט. ערך חסר = לפי הצפיפות (צפופה/רגילה/מרווחת) */
export const GANTT_SIZE = { weekW: { min: 20, max: 120 }, rowH: { min: 22, max: 72 } };
export type GanttSize = { weekW?: number; rowH?: number };
export function useGanttSize(initial: UserPreferences): [GanttSize, (s: GanttSize) => void] {
  const [v, setV] = useState<GanttSize>(() => currentPrefs(initial).ganttSize ?? {});
  useEffect(() => {
    const l = () => setV(cache?.ganttSize ?? {});
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [v, (s) => savePrefs({ ganttSize: s })];
}

/** רוחב עמודות "תחום" ו"צוות" בגאנט — כל משתמש מרחיב אצלו בלבד (גרירת הגבול בכותרת) */
export const GANTT_COLS = { domain: { min: 60, max: 320, def: 96 }, team: { min: 80, max: 400, def: 128 } };
export type GanttCols = { domain: number; team: number };
const colsOf = (p: UserPreferences | null | undefined): GanttCols => ({
  domain: p?.ganttCols?.domain ?? GANTT_COLS.domain.def, team: p?.ganttCols?.team ?? GANTT_COLS.team.def,
});
export function useGanttCols(initial: UserPreferences): [GanttCols, (c: GanttCols) => void] {
  const [v, setV] = useState<GanttCols>(() => colsOf(currentPrefs(initial)));
  useEffect(() => {
    const l = () => setV(colsOf(cache));
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [v, (c) => savePrefs({ ganttCols: c })];
}

export function useViewOnly(initial: UserPreferences): [boolean, (b: boolean) => void] {
  const [v, setV] = useState<boolean>(() => !!currentPrefs(initial).viewOnly);
  useEffect(() => {
    const l = () => setV(!!cache?.viewOnly);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [v, (b) => savePrefs({ viewOnly: b })];
}

export function useTextSize(initial: UserPreferences): [TextSize, (t: TextSize) => void] {
  const [v, setV] = useState<TextSize>(() => currentPrefs(initial).textSize ?? "md");
  useEffect(() => {
    const l = () => setV(cache?.textSize ?? "md");
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [v, (t) => savePrefs({ textSize: t })];
}

/** אפשרויות התצוגה הנוכחיות — נשמרות יחד עם תצוגה שמורה */
export function currentDisplay(): ViewDisplay {
  const p = cache ?? {};
  return {
    textSize: p.textSize ?? "md", barFontSize: Math.max(BAR_FONT.min, p.barFontSize ?? BAR_FONT.def), fitBarText: p.fitBarText ?? false, ganttSize: p.ganttSize ?? {},
    ganttCols: colsOf(p),
  };
}
/** טעינת תצוגה שמורה: מחילים את אפשרויות התצוגה שנשמרו איתה (תצוגות ישנות בלי display — לא משנות דבר) */
export function applyDisplay(d: ViewDisplay | undefined) {
  if (!d) return;
  const patch: Partial<UserPreferences> = {};
  if (d.textSize) patch.textSize = d.textSize;
  if (d.barFontSize) patch.barFontSize = Math.max(BAR_FONT.min, d.barFontSize);
  if (d.fitBarText !== undefined) patch.fitBarText = d.fitBarText;
  if (d.ganttSize) patch.ganttSize = d.ganttSize;
  if (d.ganttCols) patch.ganttCols = d.ganttCols;
  if (Object.keys(patch).length) savePrefs(patch);
}

/** טעינת תצוגה שמורה בבטחה: השלמת שדות חסרים מהמצב הנוכחי וסינון מזהים שכבר לא קיימים */
export function sanitizeView(cfg: Partial<ViewConfig>, current: ViewConfig, data?: PlanData): ViewConfig {
  const { display: _display, ...filters } = cfg; // אפשרויות התצוגה מוחלות בנפרד (applyDisplay) — לא נשמרות כחלק מהסינון
  const v: ViewConfig = {
    ...defaultViewConfig(),
    showMilestones: current.showMilestones, showSprints: current.showSprints, density: current.density,
    ...filters,
  };
  // תצוגות שנשמרו לפני שהשורות הרוחביות נכנסו לסינון התחומים: מי שסינן תחומים המשיך לראות אותן — שומרים על כך
  if (cfg.v !== 2 && v.domainIds?.length) v.domainIds = [...v.domainIds, ...CROSS_FILTER_IDS];
  v.v = 2;
  if (data) {
    const d = new Set([...data.domains.map((x) => x.id), ...CROSS_FILTER_IDS]), t = new Set(data.teams.map((x) => x.id));
    v.domainIds = (v.domainIds ?? []).filter((x) => d.has(x));
    v.teamIds = (v.teamIds ?? []).filter((x) => t.has(x));
  }
  return v;
}
