"use client";
// העדפות אישיות בצד הלקוח: מטמון אחד לכל המסכים (כדי שמעבר בין תצוגות לא יחזיר ערכים ישנים)
// והשמירה בשרת היא מיזוג אטומי של השדות שהשתנו בלבד.
import { api } from "@/lib/api";
import type { UserPreferences, ViewConfig, PlanData } from "@/lib/types";
import { defaultViewConfig } from "./filters";

let cache: UserPreferences | null = null;

export function currentPrefs(initial: UserPreferences): UserPreferences {
  // בשרת (SSR) המודול משותף לכל המשתמשים — אסור לשמור בו מטמון, אחרת העדפות של משתמש אחד ידלפו לאחר
  if (typeof window === "undefined") return initial;
  if (!cache) cache = { ...initial };
  return cache;
}

export function savePrefs(patch: Partial<UserPreferences>) {
  cache = { ...(cache ?? {}), ...patch };
  void api("PATCH", "/api/me/preferences", patch).catch(() => {});
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
