import type { ViewConfig } from "@/lib/types";

export const DOMAIN_W = 96;
export const TEAM_W = 128;
export const CTRL_W = 20;
export const LABEL_W = DOMAIN_W + TEAM_W + CTRL_W;
export const YEAR_H = 22;
export const MONTH_H = 22;
export const WEEK_H = 26;
export const HEADER_H = YEAR_H + MONTH_H + WEEK_H;
export const SPRINT_LANE_H = 16;

export function geometry(density: ViewConfig["density"], compare = false) {
  const weekW = density === "compact" ? 30 : density === "wide" ? 64 : 42;
  const rowH = density === "compact" ? 26 : density === "wide" ? 38 : 32;
  return { weekW, rowH: compare ? rowH + 12 : rowH, crossLaneH: density === "compact" ? 22 : 26 };
}
