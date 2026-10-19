CREATE TABLE "backlog_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"team_id" integer NOT NULL,
	"priority" varchar(40) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" integer
);
--> statement-breakpoint
ALTER TABLE "backlog_items" ADD CONSTRAINT "backlog_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlog_items" ADD CONSTRAINT "backlog_items_priority_priorities_key_fk" FOREIGN KEY ("priority") REFERENCES "public"."priorities"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "backlog_items_team_idx" ON "backlog_items" USING btree ("team_id");