-- הגנה בשכבת בסיס הנתונים: אין חפיפה בין תכולות פעילות באותה שורת צוות
-- (בנוסף לבדיקה בשרת עם נעילת שורה). שורות רוחביות (team_id IS NULL) פטורות.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_no_overlap"
  EXCLUDE USING gist ("row_id" WITH =, daterange("start_week", "end_week", '[]') WITH &&)
  WHERE ("deleted_at" IS NULL AND "team_id" IS NOT NULL);
