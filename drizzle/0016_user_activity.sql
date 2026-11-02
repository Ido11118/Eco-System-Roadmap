CREATE TABLE "user_activity" (
	"user_id" integer NOT NULL,
	"day" date NOT NULL,
	"source" varchar(10) DEFAULT 'web' NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"logins" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_activity_user_id_day_source_pk" PRIMARY KEY("user_id","day","source")
);
--> statement-breakpoint
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_activity_day_idx" ON "user_activity" USING btree ("day");