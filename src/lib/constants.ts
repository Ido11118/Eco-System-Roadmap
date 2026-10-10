export const STATUSES = [
  "PLANNED", "IN_PROGRESS", "DONE", "DONE_UNPLANNED", "BLOCKED", "WAITING", "POSTPONED", "CANCELLED",
] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ["NONE", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type PriorityT = (typeof PRIORITIES)[number];

export const STATUS_META: Record<Status, { label: string; bg: string; fg: string; border: string }> = {
  PLANNED: { label: "מתוכנן", bg: "#ffffff", fg: "#334155", border: "#b8c0cc" },
  IN_PROGRESS: { label: "בביצוע", bg: "#f59e0b", fg: "#3b2300", border: "#d48806" },
  DONE: { label: "בוצע", bg: "#15803d", fg: "#ffffff", border: "#116b33" },
  DONE_UNPLANNED: { label: "בוצע ולא תוכנן", bg: "#86efac", fg: "#14532d", border: "#4ade80" },
  BLOCKED: { label: "חסום / קיימת בעיה", bg: "#dc2626", fg: "#ffffff", border: "#b91c1c" },
  WAITING: { label: "ממתין לצוות אחר", bg: "#7dd3fc", fg: "#0c4a6e", border: "#38bdf8" },
  POSTPONED: { label: "נדחה", bg: "#fde047", fg: "#4d3d00", border: "#eab308" },
  CANCELLED: { label: "בוטל", bg: "#52525b", fg: "#f4f4f5", border: "#3f3f46" },
};

/** סטטוסים שמומלץ להוסיף להם הסבר בהערות */
export const NOTE_RECOMMENDED: Status[] = ["POSTPONED", "BLOCKED", "CANCELLED"];

export const COMPLETED_STATUSES: Status[] = ["DONE", "DONE_UNPLANNED"];

export const PRIORITY_META: Record<PriorityT, { label: string; color: string; rank: number }> = {
  NONE: { label: "ללא", color: "#94a3b8", rank: 4 },
  CRITICAL: { label: "קריטי", color: "#dc2626", rank: 0 },
  HIGH: { label: "גבוה", color: "#ea580c", rank: 1 },
  MEDIUM: { label: "בינוני", color: "#ca8a04", rank: 2 },
  LOW: { label: "נמוך", color: "#64748b", rank: 3 },
};

export const CROSS_ROW_LABELS = {
  INFLUENCE: "גורמים משפיעים",
  CROSS_EVENT: "מופעים רוחביים",
} as const;
