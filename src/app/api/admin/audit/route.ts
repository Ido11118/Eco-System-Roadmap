import { desc, eq } from "drizzle-orm";
import { route } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
export const GET = route(async (req) => {
  await requireSuper();
  const limit = Math.max(1, Math.min(Math.floor(Number(req.nextUrl.searchParams.get("limit") ?? 300)) || 300, 2000));
  const rows = await db.select({
    id: auditLogs.id, at: auditLogs.at, entityType: auditLogs.entityType, entityId: auditLogs.entityId,
    action: auditLogs.action, summary: auditLogs.summary, userName: users.fullName,
  }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId)).orderBy(desc(auditLogs.at)).limit(limit);
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
});
