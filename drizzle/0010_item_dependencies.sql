ALTER TABLE "work_items" ADD COLUMN "dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- צוות חדש "אלביט" בתחום אג"ם (id 2). רק בסביבה שכבר מאותחלת ורק אם אין כבר צוות פעיל בשם הזה
-- (בהתקנה חדשה הצוות נוצר מ-src/lib/org.ts). המזהה בסגנון הקיים: 2xx הפנוי הבא.
INSERT INTO "teams" ("id", "key", "name", "domain_id", "sort_order")
SELECT n.id, 'team-' || n.id, 'אלביט', 2, n.sort
FROM (
  SELECT COALESCE(MAX("id") FILTER (WHERE "id" > 200 AND "id" < 300), 200) + 1 AS id,
         COALESCE(MAX("sort_order") FILTER (WHERE "domain_id" = 2), 0) + 10 AS sort
  FROM "teams"
) n
WHERE EXISTS (SELECT 1 FROM "domains" WHERE "id" = 2)
  AND NOT EXISTS (SELECT 1 FROM "teams" WHERE "domain_id" = 2 AND "name" = 'אלביט' AND "archived_at" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "teams" WHERE "id" = n.id);
--> statement-breakpoint
INSERT INTO "work_rows" ("kind", "team_id", "sort_order")
SELECT 'TEAM', t."id", g * 1000
FROM "teams" t CROSS JOIN generate_series(1, 2) g
WHERE t."domain_id" = 2 AND t."name" = 'אלביט' AND t."archived_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "work_rows" r WHERE r."team_id" = t."id");
