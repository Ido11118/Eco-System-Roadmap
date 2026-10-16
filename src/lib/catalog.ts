// קטלוג הסטטוסים והתיעדופים — נשמר בבסיס הנתונים וניתן לעריכה ע"י מנהל המערכת (ניהול מערכת ← הגדרות).
// לוגיקה טהורה: משמשת גם את השרת וגם את הממשק. ערכי ברירת המחדל זהים למערכת המקורית.
import { STATUS_META, PRIORITY_META, STATUSES, PRIORITIES, NOTE_RECOMMENDED } from "./constants";

/** המשמעות העסקית של סטטוס — קובעת חישובים (למשל "הושלם" בהשוואת תכנון מול ביצוע), ללא תלות בשם */
export type StatusCategory = "planned" | "active" | "done" | "done_unplanned" | "cancelled" | "other";
export const STATUS_CATEGORIES: { key: StatusCategory; label: string; hint: string }[] = [
  { key: "planned", label: "מתוכנן", hint: "טרם התחיל" },
  { key: "active", label: "בעבודה", hint: "בביצוע, חסום, ממתין" },
  { key: "done", label: "הושלם", hint: "נספר כהשלמה בתכנון מול ביצוע" },
  { key: "done_unplanned", label: "הושלם ולא תוכנן", hint: "הושלם, וסומן כעבודה שלא הייתה בתכנון" },
  { key: "cancelled", label: "בוטל", hint: "נספר כבוטל בתכנון מול ביצוע" },
  { key: "other", label: "אחר", hint: "ללא משמעות מיוחדת" },
];

export type StatusDef = {
  key: string; label: string; bg: string; fg: string; border: string;
  category: StatusCategory; noteRecommended: boolean; sortOrder: number; isDefault: boolean; archived?: boolean;
};
export type PriorityDef = { key: string; label: string; color: string; sortOrder: number; isDefault: boolean; archived?: boolean };
export type CatalogData = { statuses: StatusDef[]; priorities: PriorityDef[] };

const BUILTIN_CATEGORY: Record<string, StatusCategory> = {
  PLANNED: "planned", IN_PROGRESS: "active", DONE: "done", DONE_UNPLANNED: "done_unplanned",
  BLOCKED: "active", WAITING: "active", POSTPONED: "active", CANCELLED: "cancelled",
};

export const DEFAULT_CATALOG: CatalogData = {
  statuses: STATUSES.map((k, i) => ({
    key: k, ...STATUS_META[k], category: BUILTIN_CATEGORY[k], noteRecommended: NOTE_RECOMMENDED.includes(k),
    sortOrder: (i + 1) * 10, isDefault: k === "PLANNED",
  })),
  priorities: PRIORITIES.map((k) => ({
    key: k, label: PRIORITY_META[k].label, color: PRIORITY_META[k].color,
    sortOrder: k === "NONE" ? 0 : (PRIORITY_META[k].rank + 1) * 10, isDefault: k === "NONE",
  })),
};

/** צבע טקסט קריא (כהה/בהיר) לפי צבע הרקע */
export function contrastText(bg: string): string {
  const h = bg.replace("#", "");
  if (h.length !== 6) return "#0f172a";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#1e293b" : "#ffffff";
}
/** צבע מסגרת: גוון כהה מעט מהרקע; לרקע לבן כמעט — אפור עדין */
export function borderFor(bg: string): string {
  const h = bg.replace("#", "");
  if (h.length !== 6) return "#94a3b8";
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (c.every((x) => x > 240)) return "#b8c0cc";
  return "#" + c.map((x) => Math.round(x * 0.82).toString(16).padStart(2, "0")).join("");
}

const UNKNOWN_STATUS = (key: string): StatusDef => ({
  key, label: key, bg: "#e2e8f0", fg: "#334155", border: "#94a3b8", category: "other", noteRecommended: false, sortOrder: 9999, isDefault: false,
});
const UNKNOWN_PRIORITY = (key: string): PriorityDef => ({ key, label: key, color: "#94a3b8", sortOrder: 9999, isDefault: false });

/** statuses/priorities = הפעילים בלבד (לבחירה, סינון ומקרא). status()/priority() מוצאים גם ערכים בארכיון. */
export type Catalog = CatalogData & {
  status: (key: string) => StatusDef; // תמיד מחזיר ערך (גם לסטטוס שנמחק — למשל בתוך Snapshot ישן)
  priority: (key: string) => PriorityDef;
  defaultStatus: string;
  defaultPriority: string;
  category: (statusKey: string) => StatusCategory;
};

export function makeCatalog(d: CatalogData): Catalog {
  const sm = new Map(d.statuses.map((s) => [s.key, s]));
  const pm = new Map(d.priorities.map((p) => [p.key, p]));
  const statuses = d.statuses.filter((s) => !s.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const priorities = d.priorities.filter((p) => !p.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    statuses, priorities,
    status: (k) => sm.get(k) ?? UNKNOWN_STATUS(k),
    priority: (k) => pm.get(k) ?? UNKNOWN_PRIORITY(k),
    defaultStatus: (statuses.find((s) => s.isDefault) ?? statuses[0])?.key ?? "PLANNED",
    defaultPriority: (priorities.find((p) => p.isDefault) ?? priorities[0])?.key ?? "NONE",
    category: (k) => sm.get(k)?.category ?? BUILTIN_CATEGORY[k] ?? "other",
  };
}

export const DEFAULT_CATALOG_OBJ = makeCatalog(DEFAULT_CATALOG);
