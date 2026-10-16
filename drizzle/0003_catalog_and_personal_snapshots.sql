-- (1) סטטוסים ותיעדופים הופכים לקטלוג הניתן לעריכה (במקום enum קבוע).
-- המפתחות הקיימים נשמרים, כך שכל התכולות וה-Snapshots הקיימים ממשיכים לעבוד כמו שהם.
CREATE TABLE "statuses" (
	"key" varchar(40) PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"bg" varchar(9) NOT NULL,
	"fg" varchar(9) NOT NULL,
	"border" varchar(9) NOT NULL,
	"category" varchar(20) DEFAULT 'other' NOT NULL,
	"note_recommended" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "statuses_category_chk" CHECK ("statuses"."category" in ('planned','active','done','done_unplanned','cancelled','other'))
);
--> statement-breakpoint
CREATE TABLE "priorities" (
	"key" varchar(40) PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color" varchar(9) NOT NULL,
	"sort_order" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "statuses_one_default" ON "statuses" USING btree ("is_default") WHERE "statuses"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "priorities_one_default" ON "priorities" USING btree ("is_default") WHERE "priorities"."is_default";--> statement-breakpoint
INSERT INTO "statuses" ("key","label","bg","fg","border","category","note_recommended","sort_order","is_default") VALUES
	('PLANNED','מתוכנן','#ffffff','#334155','#b8c0cc','planned',false,10,true),
	('IN_PROGRESS','בביצוע','#f59e0b','#3b2300','#d48806','active',false,20,false),
	('DONE','בוצע','#15803d','#ffffff','#116b33','done',false,30,false),
	('DONE_UNPLANNED','בוצע ולא תוכנן','#86efac','#14532d','#4ade80','done_unplanned',false,40,false),
	('BLOCKED','חסום / קיימת בעיה','#dc2626','#ffffff','#b91c1c','active',true,50,false),
	('WAITING','ממתין לצוות אחר','#7dd3fc','#0c4a6e','#38bdf8','active',false,60,false),
	('POSTPONED','נדחה','#fde047','#4d3d00','#eab308','active',true,70,false),
	('CANCELLED','בוטל','#52525b','#f4f4f5','#3f3f46','cancelled',true,80,false);
--> statement-breakpoint
INSERT INTO "priorities" ("key","label","color","sort_order","is_default") VALUES
	('NONE','ללא','#94a3b8',0,true),
	('CRITICAL','קריטי','#dc2626',10,false),
	('HIGH','גבוה','#ea580c',20,false),
	('MEDIUM','בינוני','#ca8a04',30,false),
	('LOW','נמוך','#64748b',40,false);
--> statement-breakpoint
ALTER TABLE "work_items" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "work_items" ALTER COLUMN "priority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "work_items" ALTER COLUMN "status" SET DATA TYPE varchar(40) USING "status"::text;--> statement-breakpoint
ALTER TABLE "work_items" ALTER COLUMN "priority" SET DATA TYPE varchar(40) USING "priority"::text;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_status_statuses_key_fk" FOREIGN KEY ("status") REFERENCES "public"."statuses"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_priority_priorities_key_fk" FOREIGN KEY ("priority") REFERENCES "public"."priorities"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "work_items_status_idx" ON "work_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_items_priority_idx" ON "work_items" USING btree ("priority");--> statement-breakpoint
DROP TYPE "public"."item_status";--> statement-breakpoint
DROP TYPE "public"."priority";--> statement-breakpoint
-- (2) תמונות מצב אישיות: owner_id ריק = משותפת (מנהל המערכת); אחרת = אישית, גלויה רק לבעליה
ALTER TABLE "snapshots" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshots_owner_idx" ON "snapshots" USING btree ("owner_id");
