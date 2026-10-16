import { eq, sql } from "drizzle-orm";
import { route } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { openRequestsCount } from "@/server/requests";
// מספר הפניות הממתינות למנהל המערכת: הרשמות + בקשות הרשאה + בקשות איפוס סיסמה — לתג בסרגל הצד
export const GET = route(async () => {
  await requireSuper();
  const [{ users: pending }] = await db.select({ users: sql<number>`count(*)::int` }).from(users).where(eq(users.status, "PENDING"));
  const requests = await openRequestsCount();
  return { count: pending + requests, users: pending, requests };
});
