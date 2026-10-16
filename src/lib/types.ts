import type { ISODate } from "./weeks";

export type DomainDTO = { id: number; key: string; name: string; sortOrder: number; isSingleTeam: boolean };
export type TeamDTO = { id: number; key: string; name: string; domainId: number; sortOrder: number };
export type RowKindT = "TEAM" | "INFLUENCE" | "CROSS_EVENT";
export type RowDTO = { id: number; kind: RowKindT; teamId: number | null; sortOrder: number; version: number };

export type ItemDTO = {
  id: number;
  name: string;
  rowId: number;
  teamId: number | null;
  startWeek: ISODate;
  endWeek: ISODate;
  status: string; // מפתח מקטלוג הסטטוסים
  priority: string; // מפתח מקטלוג התיעדופים
  notes: string;
  version: number;
  createdAt: string;
  createdById: number | null;
  updatedAt: string;
  updatedById: number | null;
};

export type MilestoneDTO = {
  id: number; name: string; date: ISODate; teamId: number | null; notes: string; version: number;
  createdById: number | null; createdAt: string; updatedAt: string; updatedById: number | null;
};

export type SprintDTO = {
  id: number; name: string; startDate: ISODate; endDate: ISODate; domainId: number; notes: string; version: number;
  createdById: number | null; createdAt: string; updatedAt: string; updatedById: number | null;
};

export type UserLite = { id: number; fullName: string };

/** נתוני תוכנית — זהה במבנה למצב נוכחי ולתוכן Snapshot */
export type PlanData = {
  domains: DomainDTO[];
  teams: TeamDTO[];
  rows: RowDTO[];
  items: ItemDTO[];
  milestones: MilestoneDTO[];
  sprints: SprintDTO[];
  users: UserLite[];
};

export type Me = {
  id: number;
  email: string;
  fullName: string;
  role: "SUPER" | "USER";
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  canEditCross: boolean;
  domainIds: number[];
  preferences: UserPreferences;
};

export type UserPreferences = {
  showMilestones?: boolean;
  showSprints?: boolean;
  density?: "compact" | "normal" | "wide";
  tableColumnWidths?: Record<string, number>;
  lastView?: ViewConfig; // הסינונים והגדרות התצוגה האחרונים — משוחזרים בכניסה הבאה
  lastMode?: "gantt" | "table" | "compare"; // התצוגה האחרונה שבה המשתמש עבד
  sidebarCollapsed?: boolean;
  textSize?: TextSize; // גודל התצוגה האישי (גודל טקסט וכל הממשק)
  tableCollapsed?: number[]; // צוותים שמקטע שלהם מכווץ בטבלת התכולות
  barFontSize?: number; // גודל הטקסט בתוך קוביות הגאנט (פיקסלים)
};
export type TextSize = "sm" | "md" | "lg" | "xl";

export type ViewConfig = {
  v?: 2; // גרסת המבנה: מ-2, domainIds כולל גם את השורות הרוחביות (מזהים שליליים)
  domainIds: number[]; // ריק = הכל. -1 = גורמים משפיעים, -2 = מופעים רוחביים
  teamIds: number[];
  statuses: string[];
  priorities: string[];
  search: string;
  time: TimeFilter;
  showItems?: boolean; // שכבת התכולות בגאנט (ברירת מחדל: מוצגת)
  showMilestones: boolean;
  showSprints: boolean;
  density: "compact" | "normal" | "wide";
  mode?: "gantt" | "table";
};

export type TimeFilter =
  | { kind: "all" }
  | { kind: "currentWeek" }
  | { kind: "currentMonth" }
  | { kind: "quarter"; year: number; q: number }
  | { kind: "year"; year: number }
  | { kind: "dates"; from: ISODate; to: ISODate };

export type SnapshotMeta = {
  id: number;
  name: string;
  description: string;
  asOfDate: ISODate; // תאריך המצב שה-Snapshot מייצג
  scope: "shared" | "personal"; // משותף (מנהל המערכת) / אישי (גלוי רק לבעליו)
  canManage: boolean; // האם המשתמש הנוכחי רשאי לערוך/למחוק
  createdAt: string;
  createdBy: string;
  currentRevisionId: number;
  currentRevisionNo: number;
  revisionCount: number;
};
