// אתחול מבנה ארגוני + שורות ברירת מחדל + שורות רוחביות + Super User (מתוך משתני סביבה).
// בטוח להרצה חוזרת (idempotent).
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { domains, teams, workRows } from "../src/db/schema";
import { ORG_STRUCTURE, DEFAULT_ROWS_PER_TEAM } from "../src/lib/org";
import { ensureSuperUser } from "./superuser";

async function main() {
  let dOrder = 0;
  for (const d of ORG_STRUCTURE) {
    dOrder += 10;
    const isSingle = d.teams.length === 1 && d.teams[0].name === d.name;
    await db.insert(domains).values({ id: d.id, key: d.key, name: d.name, sortOrder: dOrder, isSingleTeam: isSingle })
      .onConflictDoUpdate({ target: domains.id, set: { name: d.name, key: d.key, sortOrder: dOrder, isSingleTeam: isSingle } });
    let tOrder = 0;
    for (const t of d.teams) {
      tOrder += 10;
      await db.insert(teams).values({ id: t.id, key: t.key, name: t.name, domainId: d.id, sortOrder: tOrder })
        .onConflictDoUpdate({ target: teams.id, set: { name: t.name, key: t.key, domainId: d.id, sortOrder: tOrder } });
      const existing = await db.select({ c: sql<number>`count(*)::int` }).from(workRows)
        .where(and(eq(workRows.teamId, t.id), isNull(workRows.deletedAt)));
      for (let i = existing[0].c; i < DEFAULT_ROWS_PER_TEAM; i++) {
        await db.insert(workRows).values({ kind: "TEAM", teamId: t.id, sortOrder: (i + 1) * 1000 });
      }
    }
  }
  for (const kind of ["INFLUENCE", "CROSS_EVENT"] as const) {
    const ex = await db.select().from(workRows).where(and(eq(workRows.kind, kind), isNull(workRows.deletedAt)));
    if (!ex.length) await db.insert(workRows).values({ kind, teamId: null, sortOrder: kind === "INFLUENCE" ? 1 : 2 });
  }
  console.log("✓ org structure seeded");
  await ensureSuperUser();
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
