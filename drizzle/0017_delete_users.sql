CREATE TABLE "deleted_users" (
	"id" integer PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by_id" integer
);
--> statement-breakpoint
ALTER TABLE "snapshot_revisions" DROP CONSTRAINT IF EXISTS "snapshot_revisions_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "snapshots" DROP CONSTRAINT IF EXISTS "snapshots_created_by_id_users_id_fk";
