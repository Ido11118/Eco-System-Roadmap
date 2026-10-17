import { z } from "zod";
import { isISODate, isSunday } from "./weeks";

export const isoDate = z.string().refine(isISODate, "תאריך לא תקין");
export const sunday = isoDate.refine(isSunday, "שבוע חייב להתחיל ביום ראשון");
const name = z.string().trim().min(1, "יש להזין שם").max(300, "השם ארוך מדי");
const notes = z.string().max(5000, "ההערה ארוכה מדי");
// סטטוס/תיעדוף: מפתח מהקטלוג (נבדק מול בסיס הנתונים בשרת)
const status = z.string().trim().min(1).max(40);
const priority = z.string().trim().min(1).max(40);
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

// שיוך: teamId (צוות) או domainId (תחום שלם); שניהם null = רוחבי
export const milestoneSchema = z.object({ name, date: isoDate, teamId: id.nullable(), domainId: id.nullable().optional(), notes: notes.optional() })
  .refine((v) => v.teamId === null || v.domainId == null, { message: "אבן דרך משויכת לצוות או לתחום — לא לשניהם" });
export const milestonePatchSchema = z.object({
  version: z.number().int(),
  patch: z.object({ name: name.optional(), date: isoDate.optional(), teamId: id.nullable().optional(), domainId: id.nullable().optional(), notes: notes.optional() }).strict(),
});

export const sprintSchema = z.object({ name, startDate: isoDate, endDate: isoDate, domainId: id, notes: notes.optional() })
  .refine((v) => v.endDate >= v.startDate, { message: "תאריך הסיום אינו יכול להיות לפני תאריך ההתחלה" });
export const sprintPatchSchema = z.object({
  version: z.number().int(),
  patch: z.object({ name: name.optional(), startDate: isoDate.optional(), endDate: isoDate.optional(), domainId: id.optional(), notes: notes.optional() }).strict(),
});

export const viewConfigSchema = z.object({
  v: z.literal(2).optional(),
  domainIds: z.array(z.number().int()).default([]), // מזהים שליליים = שורות רוחביות
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
  showItems: z.boolean().default(true),
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
  textSize: z.enum(["sm", "md", "lg", "xl"]).optional(),
  tableCollapsed: z.array(z.number().int()).max(500).optional(),
  barFontSize: z.number().int().min(9).max(16).optional(),
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
    id: z.number().int(), name, date: isoDate, teamId: z.number().int().nullable(), domainId: z.number().int().nullable().default(null), notes: z.string(), version: z.number().int(),
    createdById: z.number().int().nullable(), createdAt: z.string(), updatedAt: z.string(), updatedById: z.number().int().nullable(),
  })),
  sprints: z.array(z.object({
    id: z.number().int(), name, startDate: isoDate, endDate: isoDate, domainId: z.number().int(), notes: z.string(), version: z.number().int(),
    createdById: z.number().int().nullable(), createdAt: z.string(), updatedAt: z.string(), updatedById: z.number().int().nullable(),
  })),
  users: z.array(z.object({ id, fullName: z.string() })),
});

export const snapshotCreateSchema = z.object({
  name: z.string().trim().min(1, "יש להזין שם ל-Snapshot").max(150),
  description: z.string().max(2000).default(""),
  asOfDate: isoDate.optional(),
  scope: z.enum(["shared", "personal"]).optional(),
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

// --- קטלוג סטטוסים ותיעדופים (ניהול מערכת) ---
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "צבע לא תקין");
const label = z.string().trim().min(1, "יש להזין שם").max(40, "השם ארוך מדי");
export const statusCreateSchema = z.object({
  label, bg: color,
  category: z.enum(["planned", "active", "done", "done_unplanned", "cancelled", "other"]),
  noteRecommended: z.boolean().default(false),
  isDefault: z.boolean().optional(),
});
export const statusPatchSchema = statusCreateSchema.partial().extend({ sortOrder: z.number().int().optional(), archived: z.literal(false).optional() });
export const priorityCreateSchema = z.object({ label, color, isDefault: z.boolean().optional() });
export const priorityPatchSchema = priorityCreateSchema.partial().extend({ sortOrder: z.number().int().optional(), archived: z.literal(false).optional() });

// --- פניות והגדרות משתמש ---
export const permissionRequestSchema = z.object({
  domainIds: z.array(id).max(50).default([]),
  requestCross: z.boolean().default(false),
  note: z.string().max(500).default(""),
});
export const changePasswordSchema = z.object({
  current: z.string().min(1, "יש להזין את הסיסמה הנוכחית"),
  next: z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים").max(200),
});
export const handleRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), domainIds: z.array(id), requestCross: z.boolean() }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("link") }),
  z.object({ action: z.literal("dismiss") }),
]);

// ייבוא בעזרת AI (נשלח מהתצוגה המקדימה אחרי נרמול). השרת בודק שוב הרשאות, קטלוג וחפיפות.
const importItem = z.object({
  name, teamId: id.nullable(), cross: z.enum(["INFLUENCE", "CROSS_EVENT"]).nullable(), startWeek: sunday, endWeek: sunday,
  status: status.optional(), priority: priority.optional(), notes,
}).refine((v) => v.endWeek >= v.startWeek, { message: "שבוע הסיום אינו יכול להיות לפני שבוע ההתחלה" })
  .refine((v) => (v.teamId === null) !== (v.cross === null), { message: "תכולה חייבת להיות משויכת לצוות או לשורה רוחבית" });
const importMilestone = z.object({ name, date: isoDate, teamId: id.nullable(), domainId: id.nullable().default(null), notes })
  .refine((v) => v.teamId === null || v.domainId === null, { message: "אבן דרך משויכת לצוות או לתחום — לא לשניהם" });
const importSprint = z.object({ name, startDate: isoDate, endDate: isoDate, domainId: id, notes })
  .refine((v) => v.endDate >= v.startDate, { message: "תאריך הסיום אינו יכול להיות לפני תאריך ההתחלה" });
export const importSchema = z.object({
  items: z.array(importItem).max(300), milestones: z.array(importMilestone).max(300), sprints: z.array(importSprint).max(300),
}).refine((v) => v.items.length + v.milestones.length + v.sprints.length > 0, "אין מה לייבא")
  .refine((v) => v.items.length + v.milestones.length + v.sprints.length <= 300, "ניתן לייבא עד 300 פריטים בפעם אחת");
export const importUndoSchema = z.object({
  itemIds: z.array(id).max(300), milestoneIds: z.array(id).max(300), sprintIds: z.array(id).max(300), rowIds: z.array(id).max(300),
});
