ALTER TABLE "sprints" DROP CONSTRAINT "sprints_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "sprints" ALTER COLUMN "domain_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sprints" DROP COLUMN "team_id";