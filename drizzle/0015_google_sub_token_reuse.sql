ALTER TABLE "oauth_tokens" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uq" ON "users" USING btree ("google_sub") WHERE "users"."google_sub" IS NOT NULL;