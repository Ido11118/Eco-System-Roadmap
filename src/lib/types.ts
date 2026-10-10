import type { Status, PriorityT } from "./constants";
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
  status: Status;
  priority: PriorityT;
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
  id: number; name: string; startDate: ISODate; endDate: ISODate; teamId: number; notes: string; version: number;
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
};

export type ViewConfig = {
  domainIds: number[]; // ריק = הכל
  teamIds: number[];
  statuses: Status[];
  priorities: PriorityT[];
  search: string;
  time: TimeFilter;
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
  createdAt: string;
  createdBy: string;
  currentRevisionId: number;
  currentRevisionNo: number;
  revisionCount: number;
};
