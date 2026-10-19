-- פריטי באקלוג מקבלים מזהה מאותו מונה של התכולות (work_items_id_seq):
-- כך אין אף פעם מזהה זהה לתכולה בגאנט, וב"העברה לגאנט" התכולה נוצרת עם אותו מזהה.
ALTER TABLE "backlog_items" ALTER COLUMN "id" SET DEFAULT nextval('work_items_id_seq');--> statement-breakpoint
-- פריטים קיימים: מספור מחדש מהמונה המשותף (המזהים הישנים עלולים להתנגש בתכולות)
UPDATE "backlog_items" SET "id" = nextval('work_items_id_seq');--> statement-breakpoint
DROP SEQUENCE IF EXISTS "backlog_items_id_seq";
