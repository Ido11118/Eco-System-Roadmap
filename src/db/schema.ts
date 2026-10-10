// מודל הנתונים של מערכת תוכנית העבודה (Drizzle ORM / PostgreSQL)
// עקרונות:
// - כל הקשרים מבוססים על מזהים קבועים ולא על שמות.
// - Soft Delete לישויות תוכן (deletedAt) לצורך Undo ושחזור.
// - עמודת version לכל ישות ניתנת לעריכה (Optimistic Concurrency Control).
// - תאריכים קלנדריים נשמרים כ-DATE (מחרוזת YYYY-MM-DD); שבוע = תאריך יום ראשון שלו.
// - חותמות זמן של פעולות נשמרות כ-TIMESTAMPTZ.
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, serial, integer, text, boolean, timestamp, date, jsonb, real,
  primaryKey, uniqueIndex, index, check, varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["SUPER", "USER"]);
export const accountStatus = pgEnum("account_status", ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]);
export const itemStatus = pgEnum("item_status", [
  "PLANNED", "IN_PROGRESS", "DONE", "DONE_UNPLANNED", "BLOCKED", "WAITING", "POSTPONED", "CANCELLED",
]);
export const priority = pgEnum("priority", ["NONE", "CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const rowKind = pgEnum("row_kind", ["TEAM", "INFLUENCE", "CROSS_EVENT"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 254 }).notNull(),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("USER"),
  status: accountStatus("status").notNull().default("PENDING"),
  canEditCross: boolean("can_edit_cross").notNull().default(false),
  preferences: jsonb("preferences").notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  approvedAt: ts("approved_at"),
  approvedById: integer("approved_by_id"),
}, (t) => [
  uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
  // רק Super User אחד במערכת
  uniqueIndex("users_one_super").on(t.role).where(sql`${t.role} = 'SUPER'`),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 של טוקן הסשן
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(), // sha256 של הטוקן
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// הבקשה המקורית בעת ההרשמה — נפרדת מההרשאות שניתנו בפועל
export const approvalRequests = pgTable("user_approval_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  requestedDomainIds: integer("requested_domain_ids").array().notNull().default(sql`'{}'::integer[]`),
  requestedCross: boolean("requested_cross").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  decidedAt: ts("decided_at"),
  decidedById: integer("decided_by_id"),
});

export const domains = pgTable("domains", {
  id: integer("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  isSingleTeam: boolean("is_single_team").notNull().default(false),
});

export const teams = pgTable("teams", {
  id: integer("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  domainId: integer("domain_id").notNull().references(() => domains.id),
  sortOrder: integer("sort_order").notNull(),
}, (t) => [index("teams_domain_idx").on(t.domainId)]);

export const userDomainPermissions = pgTable("user_domain_permissions", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  domainId: integer("domain_id").notNull().references(() => domains.id),
  grantedAt: ts("granted_at").notNull().defaultNow(),
  grantedById: integer("granted_by_id"),
}, (t) => [primaryKey({ columns: [t.userId, t.domainId] })]);

export const workRows = pgTable("work_rows", {
  id: serial("id").primaryKey(),
  kind: rowKind("kind").notNull().default("TEAM"),
  teamId: integer("team_id").references(() => teams.id),
  sortOrder: real("sort_order").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdById: integer("created_by_id"),
  deletedAt: ts("deleted_at"),
  deletedById: integer("deleted_by_id"),
}, (t) => [
  index("work_rows_team_idx").on(t.teamId, t.deletedAt),
  check("work_rows_team_chk", sql`(${t.kind} = 'TEAM' AND ${t.teamId} IS NOT NULL) OR (${t.kind} <> 'TEAM' AND ${t.teamId} IS NULL)`),
]);

export const workItems = pgTable("work_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rowId: integer("row_id").notNull().references(() => workRows.id),
  teamId: integer("team_id").references(() => teams.id), // נגזר מהשורה; null לפריט רוחבי
  startWeek: date("start_week", { mode: "string" }).notNull(), // יום ראשון של שבוע ההתחלה
  endWeek: date("end_week", { mode: "string" }).notNull(), // יום ראשון של שבוע הסיום
  status: itemStatus("status").notNull().default("PLANNED"),
  priority: priority("priority").notNull().default("NONE"),
  notes: text("notes").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdById: integer("created_by_id"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedById: integer("updated_by_id"),
  deletedAt: ts("deleted_at"),
  deletedById: integer("deleted_by_id"),
}, (t) => [
  index("work_items_row_idx").on(t.rowId, t.deletedAt),
  index("work_items_team_idx").on(t.teamId),
  check("work_items_range_chk", sql`${t.endWeek} >= ${t.startWeek}`),
  check("work_items_sunday_chk", sql`extract(dow from ${t.startWeek}) = 0 AND extract(dow from ${t.endWeek}) = 0`),
]);

export const milestones = pgTable("milestones", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  teamId: integer("team_id").references(() => teams.id), // null = רוחבי
  notes: text("notes").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdById: integer("created_by_id"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedById: integer("updated_by_id"),
  deletedAt: ts("deleted_at"),
});

export const sprints = pgTable("sprints", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  teamId: integer("team_id").notNull().references(() => teams.id),
  notes: text("notes").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdById: integer("created_by_id"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedById: integer("updated_by_id"),
  deletedAt: ts("deleted_at"),
}, (t) => [check("sprints_range_chk", sql`${t.endDate} >= ${t.startDate}`)]);

export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdById: integer("created_by_id").notNull().references(() => users.id),
  currentRevisionId: integer("current_revision_id"),
  deletedAt: ts("deleted_at"),
});

// כל Revision הוא עותק מלא ובלתי משתנה של נתוני התוכנית (SnapshotData)
export const snapshotRevisions = pgTable("snapshot_revisions", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id").notNull().references(() => snapshots.id, { onDelete: "cascade" }),
  revisionNo: integer("revision_no").notNull(),
  data: jsonb("data").notNull(),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdById: integer("created_by_id").notNull().references(() => users.id),
}, (t) => [uniqueIndex("snapshot_revisions_no_uq").on(t.snapshotId, t.revisionNo)]);

export const savedViews = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: jsonb("config").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("saved_views_user_name_uq").on(t.userId, t.name)]);

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  at: ts("at").notNull().defaultNow(),
  userId: integer("user_id"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  changes: jsonb("changes"),
  summary: text("summary").notNull().default(""),
}, (t) => [
  index("audit_entity_idx").on(t.entityType, t.entityId),
  index("audit_at_idx").on(t.at),
]);
