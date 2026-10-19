"use client";
// העדפות אישיות בצד הלקוח: מטמון אחד לכל המסכים (כדי שמעבר בין תצוגות לא יחזיר ערכים ישנים)
// והשמירה בשרת היא מיזוג אטומי של השדות שהשתנו בלבד.
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import type { UserPreferences, ViewConfig, PlanData, TextSize } from "@/lib/types";
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
export const BAR_FONT = { min: 9, max: 16, def: 12 };
export function useBarFontSize(initial: UserPreferences): [number, (n: number) => void] {
  const [v, setV] = useState<number>(() => currentPrefs(initial).barFontSize ?? BAR_FONT.def);
  useEffect(() => {
    const l = () => setV(cache?.barFontSize ?? BAR_FONT.def);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [v, (n) => savePrefs({ barFontSize: n })];
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

/** טעינת תצוגה שמורה בבטחה: השלמת שדות חסרים מהמצב הנוכחי וסינון מזהים שכבר לא קיימים */
export function sanitizeView(cfg: Partial<ViewConfig>, current: ViewConfig, data?: PlanData): ViewConfig {
  const v: ViewConfig = {
    ...defaultViewConfig(),
    showMilestones: current.showMilestones, showSprints: current.showSprints, density: current.density,
    ...cfg,
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
