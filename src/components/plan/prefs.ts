"use client";
// העדפות אישיות בצד הלקוח: מטמון אחד לכל המסכים (כדי שמעבר בין תצוגות לא יחזיר ערכים ישנים)
// והשמירה בשרת היא מיזוג אטומי של השדות שהשתנו בלבד.
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import type { UserPreferences, ViewConfig, PlanData, TextSize } from "@/lib/types";
import { defaultViewConfig } from "./filters";

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
  if (data) {
    const d = new Set(data.domains.map((x) => x.id)), t = new Set(data.teams.map((x) => x.id));
    v.domainIds = (v.domainIds ?? []).filter((x) => d.has(x));
    v.teamIds = (v.teamIds ?? []).filter((x) => t.has(x));
  }
  return v;
}
