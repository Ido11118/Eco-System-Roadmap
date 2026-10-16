CREATE TABLE "app_settings" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "priorities" ADD COLUMN "replaced_by" varchar(40);--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN "replaced_by" varchar(40);