// שיוך אבן דרך: צוות / תחום שלם / רוחבי (כל הארגון). לוגיקה טהורה לממשק.
import type { MilestoneDTO, PlanData } from "./types";

type MsScope = Pick<MilestoneDTO, "teamId" | "domainId">;
type Perms = { canEditTeam: (teamId: number) => boolean; canEditDomain: (domainId: number) => boolean; canEditCross: () => boolean };

export const msCanEdit = (m: MsScope, p: Perms) =>
  m.teamId !== null ? p.canEditTeam(m.teamId) : m.domainId !== null ? p.canEditDomain(m.domainId) : p.canEditCross();

/** "רוחבי — כל הארגון" / "אג"ם (כל התחום)" / "אג"ם / עזרים 1" */
export function msScopeLabel(m: MsScope, data: PlanData): string {
  if (m.teamId !== null) {
    const t = data.teams.find((x) => x.id === m.teamId);
    const d = data.domains.find((x) => x.id === t?.domainId);
    return d && t && d.name !== t.name ? `${d.name} / ${t.name}` : t?.name ?? "";
  }
  if (m.domainId !== null) return `${data.domains.find((x) => x.id === m.domainId)?.name ?? ""} (כל התחום)`;
  return "רוחבי — כל הארגון";
}

/** ערך בחירת השיוך בטפסים: "cross" / "d:<תחום>" / "<צוות>" */
export const msScopeValue = (m: MsScope) => (m.teamId !== null ? String(m.teamId) : m.domainId !== null ? `d:${m.domainId}` : "cross");
export function parseMsScope(v: string): MsScope {
  if (v === "cross") return { teamId: null, domainId: null };
  if (v.startsWith("d:")) return { teamId: null, domainId: Number(v.slice(2)) };
  return { teamId: Number(v), domainId: null };
}
