ALTER TABLE "snapshots" ADD COLUMN "as_of_date" date DEFAULT CURRENT_DATE NOT NULL;--> statement-breakpoint
-- Snapshots קיימים: תאריך המצב = תאריך היצירה (לפי שעון ישראל)
UPDATE "snapshots" SET "as_of_date" = ("created_at" AT TIME ZONE 'Asia/Jerusalem')::date;
