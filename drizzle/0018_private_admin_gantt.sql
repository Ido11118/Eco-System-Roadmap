CREATE TABLE "personal_gantt_items" (
	"user_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_gantt_items_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "personal_gantt_items" ADD CONSTRAINT "personal_gantt_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_gantt_items" ADD CONSTRAINT "personal_gantt_items_item_id_work_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;