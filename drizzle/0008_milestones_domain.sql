-- אבן דרך יכולה להיות משויכת גם לתחום שלם (domain_id), בנוסף לצוות או לרוחבי (כל הארגון).
ALTER TABLE "milestones" ADD COLUMN "domain_id" integer;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_scope_chk" CHECK ("milestones"."team_id" IS NULL OR "milestones"."domain_id" IS NULL);