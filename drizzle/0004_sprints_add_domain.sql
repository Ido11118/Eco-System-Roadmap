-- ספרינט שייך לתחום כולו. השלב השני (0005) מסיר את team_id.
ALTER TABLE "sprints" ADD COLUMN "domain_id" integer;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ספרינטים עוברים מצוות לתחום: ספרינט קיים מקבל את התחום של הצוות שלו
UPDATE "sprints" s SET "domain_id" = t."domain_id" FROM "teams" t WHERE t."id" = s."team_id";
