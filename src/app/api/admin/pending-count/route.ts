import { eq, sql } from "drizzle-orm";
import { route } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
// מספר בקשות ההרשמה הממתינות — לתג בסרגל הצד של מנהל המערכת
export const GET = route(async () => {
  await requireSuper();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.status, "PENDING"));
  return { count };
});
