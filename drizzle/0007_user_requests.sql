CREATE TABLE "user_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(20) NOT NULL,
	"domain_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"request_cross" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by_id" integer,
	CONSTRAINT "user_requests_kind_chk" CHECK ("user_requests"."kind" in ('permissions','password_reset')),
	CONSTRAINT "user_requests_status_chk" CHECK ("user_requests"."status" in ('open','approved','rejected','done'))
);
--> statement-breakpoint
ALTER TABLE "user_requests" ADD CONSTRAINT "user_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_requests_one_open" ON "user_requests" USING btree ("user_id","kind") WHERE "user_requests"."status" = 'open';