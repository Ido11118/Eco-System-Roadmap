// השוואת תכנון (Snapshot) מול מצב נוכחי — לוגיקה טהורה, ללא תלות ב-UI או בבסיס הנתונים.
// ההתאמה מתבצעת אך ורק לפי ID קבוע של תכולה.
import { COMPLETED_STATUSES, type Status } from "./constants";
import type { ItemDTO, PlanData, RowDTO } from "./types";
import { weeksDiff, type ISODate } from "./weeks";

export type ChangeTag =
  | "unchanged" // טווח זמן זהה, לא בוטל ולא נמחק
  | "delayed" // הטווח הנוכחי מאוחר מהמתוכנן
  | "advanced" // הטווח הנוכחי מוקדם מהמתוכנן
  | "extended" // משך הזמן התארך
  | "shortened" // משך הזמן התקצר
  | "added" // קיים רק במצב הנוכחי
  | "deleted" // קיים רק ב-Snapshot
  | "cancelled" // סטטוס נוכחי "בוטל"
  | "completed" // סטטוס נוכחי מצביע על השלמה
  | "notCompleted" // תוכנן, קיים, לא הושלם ולא בוטל
  | "completedUnplanned" // נוסף אחרי ה-Baseline והושלם, או בסטטוס "בוצע ולא תוכנן"
  | "moved" // הועבר צוות
  | "renamed";

export type Range = { start: ISODate; end: ISODate };

export type CompareUnit = {
  id: number;
  name: string;
  teamId: number | null; // צוות התצוגה (נוכחי אם קיים, אחרת מה-Snapshot)
  rowId: number; // שורת ההעדפה לתצוגה
  rowKind: RowDTO["kind"]; // סוג שורת התצוגה (נוכחית אם קיימת)
  planRowKind: RowDTO["kind"] | null; // סוג השורה ב-Snapshot (קובע השתייכות ל-Baseline בסיכום)
  plan: (Range & { status: Status; name: string; teamId: number | null; rowId: number }) | null;
  actual: (Range & { status: Status; name: string; teamId: number | null; rowId: number; item: ItemDTO }) | null;
  tags: ChangeTag[];
  startDelta: number | null; // בשבועות; חיובי = מאוחר יותר
  endDelta: number | null;
  durationDelta: number | null;
  description: string;
};

const EPOCH = "2000-01-02"; // יום ראשון
export const weekIdx = (s: ISODate) => weeksDiff(EPOCH, s);

function plural(n: number) {
  const a = Math.abs(n);
  return a === 1 ? "שבוע" : a === 2 ? "שבועיים" : `${a} שבועות`;
}

export function describeUnit(u: Omit<CompareUnit, "description">): string {
  const t = new Set(u.tags);
  if (t.has("deleted")) return "התכולה נמחקה מהתוכנית הנוכחית לאחר ה-Snapshot.";
  if (t.has("added")) {
    return t.has("completedUnplanned")
      ? "התכולה נוספה לאחר ה-Snapshot והושלמה (לא הייתה בתכנון)."
      : "התכולה נוספה לאחר ה-Snapshot.";
  }
  const parts: string[] = [];
  const sd = u.startDelta ?? 0, ed = u.endDelta ?? 0, dd = u.durationDelta ?? 0;
  if (sd === 0 && ed === 0) parts.push("ללא שינוי בטווח הזמן.");
  else {
    if (sd > 0) parts.push(`תחילת העבודה נדחתה ב${plural(sd)}.`);
    if (sd < 0) parts.push(`תחילת העבודה הוקדמה ב${plural(sd)}.`);
    if (ed > 0) parts.push(`הסיום נדחה ב${plural(ed)}.`);
    if (ed < 0) parts.push(`הסיום הוקדם ב${plural(ed)}.`);
    if (dd > 0) parts.push(`משך הזמן התארך ב${plural(dd)}.`);
    if (dd < 0) parts.push(`משך הזמן התקצר ב${plural(dd)}.`);
  }
  if (t.has("cancelled")) parts.push("התכולה בוטלה.");
  else if (t.has("completed")) parts.push("התכולה הושלמה.");
  else if (t.has("notCompleted")) parts.push("התכולה טרם הושלמה.");
  if (t.has("moved")) parts.push("התכולה הועברה לצוות אחר.");
  if (t.has("renamed")) parts.push("שם התכולה שונה.");
  return parts.join(" ");
}

export function classify(plan: ItemDTO | undefined, actual: ItemDTO | undefined): {
  tags: ChangeTag[]; startDelta: number | null; endDelta: number | null; durationDelta: number | null;
} {
  const tags: ChangeTag[] = [];
  if (!plan && actual) {
    tags.push("added");
    if (COMPLETED_STATUSES.includes(actual.status) || actual.status === "DONE_UNPLANNED") {
      tags.push("completed", "completedUnplanned");
    }
    if (actual.status === "CANCELLED") tags.push("cancelled");
    return { tags, startDelta: null, endDelta: null, durationDelta: null };
  }
  if (plan && !actual) {
    tags.push("deleted");
    return { tags, startDelta: null, endDelta: null, durationDelta: null };
  }
  const p = plan!, a = actual!;
  const sd = weeksDiff(p.startWeek, a.startWeek);
  const ed = weeksDiff(p.endWeek, a.endWeek);
  const dd = ed - sd;
  // לכל תכולה בדיוק סיווג זמן אחד: ללא שינוי / נדחה / הוקדם.
  // הקובע הוא מועד הסיום (מועד המסירה); אם הסיום זהה — מועד ההתחלה.
  const primary = ed !== 0 ? ed : sd;
  if (primary === 0) tags.push("unchanged");
  else if (primary > 0) tags.push("delayed");
  else tags.push("advanced");
  if (dd > 0) tags.push("extended");
  if (dd < 0) tags.push("shortened");
  if (a.status === "CANCELLED") tags.push("cancelled");
  else if (COMPLETED_STATUSES.includes(a.status)) tags.push("completed"); // תכולה מתוכננת אינה "הושלמה ולא תוכננה"
  else tags.push("notCompleted");
  if (p.teamId !== a.teamId) tags.push("moved");
  if (p.name !== a.name) tags.push("renamed");
  return { tags, startDelta: sd, endDelta: ed, durationDelta: dd };
}

/** איחוד תכולות משני המצבים לפי ID */
export function buildCompareUnits(baseline: PlanData, current: PlanData): CompareUnit[] {
  const planById = new Map(baseline.items.map((i) => [i.id, i]));
  const curById = new Map(current.items.map((i) => [i.id, i]));
  const rowKind = new Map<number, RowDTO["kind"]>();
  for (const r of baseline.rows) rowKind.set(r.id, r.kind);
  for (const r of current.rows) rowKind.set(r.id, r.kind);
  const ids = new Set<number>([...planById.keys(), ...curById.keys()]);
  const units: CompareUnit[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const p = planById.get(id);
    const a = curById.get(id);
    const c = classify(p, a);
    const base = {
      id,
      name: (a ?? p)!.name,
      teamId: (a ?? p)!.teamId,
      rowId: (a ?? p)!.rowId,
      rowKind: rowKind.get((a ?? p)!.rowId) ?? "TEAM",
      planRowKind: p ? baseline.rows.find((r) => r.id === p.rowId)?.kind ?? "TEAM" : null,
      plan: p ? { start: p.startWeek, end: p.endWeek, status: p.status, name: p.name, teamId: p.teamId, rowId: p.rowId } : null,
      actual: a ? { start: a.startWeek, end: a.endWeek, status: a.status, name: a.name, teamId: a.teamId, rowId: a.rowId, item: a } : null,
      ...c,
    };
    units.push({ ...base, description: describeUnit(base) });
  }
  return units;
}

// ---------------------------------------------------------------------------
// אלגוריתם פריסת שורות וירטואליות
// ---------------------------------------------------------------------------

export type Seg = [number, number]; // אינדקסי שבועות, כולל שני הקצוות

/** איחוד מקטעים חופפים/צמודים — בדיקת חפיפה נעשית על המקטעים בפועל ולא על min–max */
export function mergeSegments(segs: Seg[]): Seg[] {
  const s = [...segs].sort((a, b) => a[0] - b[0]);
  const out: Seg[] = [];
  for (const g of s) {
    const last = out[out.length - 1];
    if (last && g[0] <= last[1] + 1) last[1] = Math.max(last[1], g[1]);
    else out.push([g[0], g[1]]);
  }
  return out;
}

export function segmentsOverlap(a: Seg[], b: Seg[]): boolean {
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i][0] <= b[j][1] && b[j][0] <= a[i][1]) return true;
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return false;
}

export function unitSegments(u: Pick<CompareUnit, "plan" | "actual">): Seg[] {
  const segs: Seg[] = [];
  if (u.plan) segs.push([weekIdx(u.plan.start), weekIdx(u.plan.end)]);
  if (u.actual) segs.push([weekIdx(u.actual.start), weekIdx(u.actual.end)]);
  return mergeSegments(segs);
}

export type Lane<T> = { rowId: number; laneIndex: number; units: T[] };

/**
 * פריסה גנרית: מקבלת יחידות (כל יחידה = ID אחד עם מקטע אחד או יותר) ושורות מקור מסודרות,
 * ומחזירה שורות וירטואליות כך ש:
 * 1. כל יחידה (ID) מוצבת בשורה וירטואלית אחת בלבד — התכנון והביצוע שלה לעולם לא מתפצלים.
 * 2. אין חפיפה בין יחידות שונות באותה שורה וירטואלית.
 * 3. כל יחידה נשארת בקבוצת השורה המקורית שלה (העדפת השורות המקוריות; סדר יציב).
 * 4. מספר מינימלי של שורות: הקצאה חמדנית לפי זמן התחלה (First-Fit), הנותנת פתרון אופטימלי למקטע יחיד.
 */
export function layoutLanes<T>(
  units: T[],
  rowOrder: number[],
  getRow: (u: T) => number,
  getSegs: (u: T) => Seg[],
  getId: (u: T) => number,
): Lane<T>[] {
  const byRow = new Map<number, T[]>();
  for (const r of rowOrder) byRow.set(r, []);
  // יחידה ששורתה אינה ברשימה (למשל שורה שנמחקה) מוצגת בשורה האחרונה; אם אין שורות כלל — בשורת חירום,
  // כדי ששום ID לא ייעלם מהתצוגה.
  if (!rowOrder.length && units.length) rowOrder = [getRow(units[0])];
  for (const r of rowOrder) if (!byRow.has(r)) byRow.set(r, []);
  const fallbackRow = rowOrder[rowOrder.length - 1];
  for (const u of units) {
    const r = byRow.has(getRow(u)) ? getRow(u) : fallbackRow;
    byRow.get(r)!.push(u);
  }
  const out: Lane<T>[] = [];
  for (const rowId of rowOrder) {
    const list = byRow.get(rowId)!;
    const withSegs = list.map((u) => ({ u, segs: getSegs(u) }));
    withSegs.sort((a, b) => (a.segs[0]?.[0] ?? 0) - (b.segs[0]?.[0] ?? 0) || getId(a.u) - getId(b.u));
    const lanes: { occ: Seg[]; units: T[] }[] = [];
    for (const { u, segs } of withSegs) {
      let lane = lanes.find((l) => !segmentsOverlap(l.occ, segs));
      if (!lane) {
        lane = { occ: [], units: [] };
        lanes.push(lane);
      }
      lane.units.push(u);
      lane.occ = mergeSegments([...lane.occ, ...segs]);
    }
    if (!lanes.length) lanes.push({ occ: [], units: [] }); // שורה ריקה עדיין מוצגת
    lanes.forEach((l, i) => out.push({ rowId, laneIndex: i, units: l.units }));
  }
  return out;
}

/** סדר השורות לקבוצה (צוות או שורה רוחבית): שורות נוכחיות ואחריהן שורות שקיימות רק ב-Snapshot */
export function rowOrderFor(teamId: number | null, kind: RowDTO["kind"], current: RowDTO[], baseline: RowDTO[]): number[] {
  const match = (r: RowDTO) => (kind === "TEAM" ? r.kind === "TEAM" && r.teamId === teamId : r.kind === kind);
  const cur = current.filter(match).sort((a, b) => a.sortOrder - b.sortOrder);
  const curIds = new Set(cur.map((r) => r.id));
  const old = baseline.filter((r) => match(r) && !curIds.has(r.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  return [...cur, ...old].map((r) => r.id);
}

export type CompareLayout = {
  units: CompareUnit[];
  /** מפתח קבוצה: `team:<id>` או `cross:<kind>` */
  lanes: Map<string, Lane<CompareUnit>[]>;
  rowsByGroup: Map<string, number[]>;
};

export function groupKeyOf(u: Pick<CompareUnit, "teamId" | "rowKind">) {
  return u.rowKind === "TEAM" ? `team:${u.teamId}` : `cross:${u.rowKind}`;
}

export function buildCompareLayout(baseline: PlanData, current: PlanData, filter?: (u: CompareUnit) => boolean): CompareLayout {
  const all = buildCompareUnits(baseline, current);
  const units = filter ? all.filter(filter) : all;
  // שורת התצוגה: שורה נוכחית אם קיימת, אחרת שורת ה-Snapshot
  const curRowIds = new Set(current.rows.map((r) => r.id));
  for (const u of units) {
    if (u.actual && curRowIds.has(u.actual.rowId)) u.rowId = u.actual.rowId;
    else if (u.plan) u.rowId = u.plan.rowId;
  }
  const groups = new Map<string, CompareUnit[]>();
  for (const u of units) {
    const k = groupKeyOf(u);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(u);
  }
  const lanes = new Map<string, Lane<CompareUnit>[]>();
  const rowsByGroup = new Map<string, number[]>();
  const teamIds = new Set<number>([...current.teams.map((t) => t.id), ...baseline.teams.map((t) => t.id)]);
  const keys = [
    "cross:INFLUENCE", "cross:CROSS_EVENT",
    ...[...teamIds].map((id) => `team:${id}`),
  ];
  for (const k of keys) {
    const [type, rest] = k.split(":");
    const order = type === "team"
      ? rowOrderFor(Number(rest), "TEAM", current.rows, baseline.rows)
      : rowOrderFor(null, rest as RowDTO["kind"], current.rows, baseline.rows);
    rowsByGroup.set(k, order);
    lanes.set(k, layoutLanes(groups.get(k) ?? [], order, (u) => u.rowId, unitSegments, (u) => u.id));
  }
  return { units, lanes, rowsByGroup };
}

// ---------------------------------------------------------------------------
// סיכום ניהולי
// ---------------------------------------------------------------------------

export type CompareSummary = {
  planned: number; // תכולות ב-Snapshot (Baseline)
  completed: number; // מתוך ה-Baseline: הושלמו
  notCompleted: number; // מתוך ה-Baseline: קיימות, לא הושלמו ולא בוטלו
  cancelled: number; // מתוך ה-Baseline: בוטלו
  deleted: number; // מתוך ה-Baseline: נמחקו
  delayed: number; // מתוך ה-Baseline: נדחו בזמן (לא חלק מהחלוקה)
  advanced: number;
  unchanged: number;
  added: number; // לא היו ב-Baseline
  completedUnplanned: number; // מתוך הנוספות: הושלמו
  completionRate: number; // completed / planned
};

/**
 * הגדרות המדדים (עקביות וללא ספירה כפולה):
 * planned = completed + notCompleted + cancelled + deleted (חלוקה מלאה של ה-Baseline).
 * delayed / advanced / unchanged — מדדי זמן נפרדים, מתוך תכולות ה-Baseline שעדיין קיימות.
 * added — תכולות שלא היו ב-Baseline; completedUnplanned ⊆ added (וכן סטטוס "בוצע ולא תוכנן").
 * מדדים מחושבים על תכולות צוות בלבד (לא על שורות רוחביות).
 */
export function summarize(units: CompareUnit[]): CompareSummary {
  const s: CompareSummary = {
    planned: 0, completed: 0, notCompleted: 0, cancelled: 0, deleted: 0,
    delayed: 0, advanced: 0, unchanged: 0, added: 0, completedUnplanned: 0, completionRate: 0,
  };
  for (const u of units) {
    const t = new Set(u.tags);
    // השתייכות ל-Baseline נקבעת לפי השורה ב-Snapshot; "נוספו" לפי השורה הנוכחית
    if (u.plan ? u.planRowKind !== "TEAM" : u.rowKind !== "TEAM") continue;
    if (u.plan) {
      s.planned++;
      if (t.has("deleted")) s.deleted++;
      else if (t.has("cancelled")) s.cancelled++;
      else if (t.has("completed")) s.completed++;
      else s.notCompleted++;
      if (t.has("delayed")) s.delayed++;
      if (t.has("advanced")) s.advanced++;
      if (t.has("unchanged")) s.unchanged++;
    } else {
      s.added++;
      if (t.has("completedUnplanned")) s.completedUnplanned++;
    }
  }
  s.completionRate = s.planned ? s.completed / s.planned : 0;
  return s;
}

export const COMPARE_FILTERS: { key: string; label: string; match: (u: CompareUnit) => boolean }[] = [
  { key: "all", label: "הכל", match: () => true },
  { key: "unchanged", label: "ללא שינוי", match: (u) => u.tags.includes("unchanged") },
  { key: "delayed", label: "נדחו", match: (u) => u.tags.includes("delayed") },
  { key: "advanced", label: "הוקדמו", match: (u) => u.tags.includes("advanced") },
  { key: "added", label: "נוספו", match: (u) => u.tags.includes("added") },
  { key: "cancelled", label: "בוטלו", match: (u) => u.tags.includes("cancelled") },
  { key: "deleted", label: "נמחקו", match: (u) => u.tags.includes("deleted") },
  { key: "notCompleted", label: "לא הושלמו", match: (u) => u.tags.includes("notCompleted") },
  { key: "completed", label: "הושלמו", match: (u) => u.tags.includes("completed") },
];

export const TAG_LABELS: Record<ChangeTag, string> = {
  unchanged: "ללא שינוי",
  delayed: "נדחה",
  advanced: "הוקדם",
  extended: "התארך",
  shortened: "התקצר",
  added: "נוסף לאחר ה-Snapshot",
  deleted: "נמחק",
  cancelled: "בוטל",
  completed: "הושלם",
  notCompleted: "לא הושלם",
  completedUnplanned: "הושלם ולא תוכנן",
  moved: "הועבר צוות",
  renamed: "שם שונה",
};
