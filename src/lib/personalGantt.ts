import type { PlanData, ViewConfig } from "./types";
import { crossRowVisible, itemMatches, timeWindow, visibleTeamIds } from "@/components/plan/filters";

/** Live references, never copies. Compact the structure around visible items. */
export function personalGanttPlan(plan: PlanData, selectedIds: number[], showSource: boolean, view: ViewConfig): PlanData {
  const selected = new Set(selectedIds);
  const window = view.time.kind === "all" ? undefined : timeWindow(view.time, plan);
  const visibleTeams = visibleTeamIds(plan, view);
  const items = plan.items.filter((i) => {
    const row = plan.rows.find((r) => r.id === i.rowId);
    const visible = row?.kind === "TEAM" ? visibleTeams.has(row.teamId!) : !!row && crossRowVisible(view, row.kind);
    return visible && (showSource || selected.has(i.id)) && itemMatches(i, view, window);
  });
  if (showSource) return { ...plan, items, milestones: [], sprints: [] };
  const rowIds = new Set(items.map((i) => i.rowId));
  const rows = plan.rows.filter((r) => rowIds.has(r.id));
  const teamIds = new Set(rows.map((r) => r.teamId));
  const teams = plan.teams.filter((t) => teamIds.has(t.id));
  const domainIds = new Set(teams.map((t) => t.domainId));
  return { ...plan, items, rows, teams, domains: plan.domains.filter((d) => domainIds.has(d.id)), milestones: [], sprints: [] };
}
