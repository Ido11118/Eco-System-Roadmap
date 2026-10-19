ALTER TABLE "backlog_items" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
-- פריטים קיימים: התחום נגזר מהצוות שלהם, ורק אז העמודה הופכת לחובה
ALTER TABLE "backlog_items" ADD COLUMN "domain_id" integer;--> statement-breakpoint
UPDATE "backlog_items" b SET "domain_id" = t."domain_id" FROM "teams" t WHERE t."id" = b."team_id";--> statement-breakpoint
ALTER TABLE "backlog_items" ALTER COLUMN "domain_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "backlog_items" ADD CONSTRAINT "backlog_items_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backlog_items_domain_idx" ON "backlog_items" USING btree ("domain_id");