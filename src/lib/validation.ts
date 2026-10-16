import { z } from "zod";
import { STATUSES, PRIORITIES } from "./constants";
import { isISODate, isSunday } from "./weeks";

export const isoDate = z.string().refine(isISODate, "תאריך לא תקין");
export const sunday = isoDate.refine(isSunday, "שבוע חייב להתחיל ביום ראשון");
const name = z.string().trim().min(1, "יש להזין שם").max(300, "השם ארוך מדי");
const notes = z.string().max(5000, "ההערה ארוכה מדי");
const status = z.enum(STATUSES);
const priority = z.enum(PRIORITIES);
const id = z.number().int().positive();

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "יש להזין שם מלא").max(120),
  email: z.string().trim().toLowerCase().email("כתובת דוא\"ל לא תקינה").max(254),
  password: z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים").max(200),
  domainIds: z.array(id).max(50).default([]),
  requestCross: z.boolean().default(false),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "יש להזין דוא\"ל"),
  password: z.string().min(1, "יש להזין סיסמה"),
});

export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email("כתובת דוא\"ל לא תקינה") });
export const resetSchema = z.object({ token: z.string().min(10), password: z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים").max(200) });

export const createItemSchema = z.object({
  rowId: id, name, startWeek: sunday, endWeek: sunday,
  status: status.optional(), priority: priority.optional(), notes: notes.optional(),
}).refine((v) => v.endWeek >= v.startWeek, { message: "שבוע הסיום אינו יכול להיות לפני שבוע ההתחלה" });

export const updateItemSchema = z.object({
  version: z.number().int(),
  patch: z.object({
    name: name.optional(), status: status.optional(), priority: priority.optional(), notes: notes.optional(),
    startWeek: sunday.optional(), endWeek: sunday.optional(), rowId: id.optional(),
  }).strict(),
});

export const bulkItemsSchema = z.object({
  entries: z.array(z.object({ id, version: z.number().int() })).min(1).max(500),
  patch: z.object({ status: status.optional(), priority: priority.optional() }).strict()
    .refine((p) => p.status || p.priority, "לא נבחר שינוי"),
});

export const createRowSchema = z.object({
  teamId: id, anchorRowId: id.optional(), position: z.enum(["above", "below"]).default("below"),
});

export const milestoneSchema = z.object({ name, date: isoDate, teamId: id.nullable(), notes: notes.optional() });
export const milestonePatchSchema = z.object({
  version: z.number().int(),
  patch: z.object({ name: name.optional(), date: isoDate.optional(), teamId: id.nullable().optional(), notes: notes.optional() }).strict(),
});

export const sprintSchema = z.object({ name, startDate: isoDate, endDate: isoDate, teamId: id, notes: notes.optional() })
  .refine((v) => v.endDate >= v.startDate, { message: "תאריך הסיום אינו יכול להיות לפני תאריך ההתחלה" });
export const sprintPatchSchema = z.object({
  version: z.number().int(),
  patch: z.object({ name: name.optional(), startDate: isoDate.optional(), endDate: isoDate.optional(), teamId: id.optional(), notes: notes.optional() }).strict(),
});

export const viewConfigSchema = z.object({
  domainIds: z.array(id).default([]),
  teamIds: z.array(id).default([]),
  statuses: z.array(status).default([]),
  priorities: z.array(priority).default([]),
  search: z.string().max(200).default(""),
  time: z.union([
    z.object({ kind: z.literal("all") }),
    z.object({ kind: z.literal("currentWeek") }),
    z.object({ kind: z.literal("currentMonth") }),
    z.object({ kind: z.literal("quarter"), year: z.number().int(), q: z.number().int().min(1).max(4) }),
    z.object({ kind: z.literal("year"), year: z.number().int() }),
    z.object({ kind: z.literal("dates"), from: isoDate, to: isoDate }),
  ]),
  showMilestones: z.boolean().default(true),
  showSprints: z.boolean().default(false),
  density: z.enum(["compact", "normal", "wide"]).default("normal"),
  mode: z.enum(["gantt", "table"]).optional(),
});

export const savedViewSchema = z.object({
  name: z.string().trim().min(1, "יש להזין שם לתצוגה").max(80),
  config: viewConfigSchema,
  isDefault: z.boolean().optional(),
});

export const preferencesSchema = z.object({
  showMilestones: z.boolean().optional(),
  showSprints: z.boolean().optional(),
  density: z.enum(["compact", "normal", "wide"]).optional(),
  tableColumnWidths: z.record(z.string(), z.number().min(40).max(1000)).optional(),
  lastView: viewConfigSchema.optional(),
  lastMode: z.enum(["gantt", "table", "compare"]).optional(),
  sidebarCollapsed: z.boolean().optional(),
}).strict();

export const adminUserActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), domainIds: z.array(id), canEditCross: z.boolean() }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("suspend") }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("setPermissions"), domainIds: z.array(id), canEditCross: z.boolean() }),
  z.object({ action: z.literal("resetLink") }),
]);

// --- Snapshot data (מבנה זהה ל-PlanData) ---
const itemDTO = z.object({
  id: z.number().int(), name, rowId: z.number().int(), teamId: z.number().int().nullable(),
  startWeek: sunday, endWeek: sunday, status, priority, notes: z.string(),
  version: z.number().int(), createdAt: z.string(), createdById: z.number().int().nullable(),
  updatedAt: z.string(), updatedById: z.number().int().nullable(),
}).refine((v) => v.endWeek >= v.startWeek, { message: "שבוע הסיום אינו יכול להיות לפני שבוע ההתחלה" });
export const planDataSchema = z.object({
  domains: z.array(z.object({ id, key: z.string(), name: z.string(), sortOrder: z.number(), isSingleTeam: z.boolean() })),
  teams: z.array(z.object({ id, key: z.string(), name: z.string(), domainId: id, sortOrder: z.number() })),
  rows: z.array(z.object({ id: z.number().int(), kind: z.enum(["TEAM", "INFLUENCE", "CROSS_EVENT"]), teamId: z.number().int().nullable(), sortOrder: z.number(), version: z.number().int() })),
  items: z.array(itemDTO),
  milestones: z.array(z.object({
    id: z.number().int(), name, date: isoDate, teamId: z.number().int().nullable(), notes: z.string(), version: z.number().int(),
    createdById: z.number().int().nullable(), createdAt: z.string(), updatedAt: z.string(), updatedById: z.number().int().nullable(),
  })),
  sprints: z.array(z.object({
    id: z.number().int(), name, startDate: isoDate, endDate: isoDate, teamId: z.number().int(), notes: z.string(), version: z.number().int(),
    createdById: z.number().int().nullable(), createdAt: z.string(), updatedAt: z.string(), updatedById: z.number().int().nullable(),
  })),
  users: z.array(z.object({ id, fullName: z.string() })),
});

export const snapshotCreateSchema = z.object({
  name: z.string().trim().min(1, "יש להזין שם ל-Snapshot").max(150),
  description: z.string().max(2000).default(""),
  asOfDate: isoDate.optional(),
});
export const snapshotMetaSchema = z.object({
  name: z.string().trim().min(1, "יש להזין שם ל-Snapshot").max(150).optional(),
  description: z.string().max(2000).optional(),
  asOfDate: isoDate.optional(),
});
export const snapshotRevisionSchema = z.object({
  baseRevisionId: id,
  note: z.string().max(500).default(""),
  data: planDataSchema,
});
