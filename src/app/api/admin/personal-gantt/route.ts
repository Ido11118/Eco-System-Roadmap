import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { personalGanttItems, workItems } from "@/db/schema";
import { requireSuper } from "@/server/auth";
import { ApiError, body, route } from "@/server/errors";

const input = z.object({
  action: z.enum(["add", "remove"]),
  ids: z.array(z.number().int().positive()).min(1).max(500),
}).strict();

export const GET = route(async () => {
  const me = await requireSuper();
  const rows = await db.select({ id: personalGanttItems.itemId }).from(personalGanttItems).where(eq(personalGanttItems.userId, me.id));
  return { ids: rows.map((r) => r.id) };
});

export const POST = route(async (req) => {
  const me = await requireSuper();
  const v = input.parse(await body(req));
  const ids = [...new Set(v.ids)].sort((a, b) => a - b);
  await db.transaction(async (tx) => {
    if (v.action === "add") {
      const items = await tx.select({ id: workItems.id }).from(workItems).where(and(inArray(workItems.id, ids), isNull(workItems.deletedAt))).for("share");
      if (items.length !== ids.length) throw new ApiError(404, "אחת התכולות נמחקה או אינה זמינה. רענן ונסה שוב.");
      await tx.insert(personalGanttItems).values(ids.map((itemId) => ({ userId: me.id, itemId }))).onConflictDoNothing();
    } else {
      await tx.delete(personalGanttItems).where(and(eq(personalGanttItems.userId, me.id), inArray(personalGanttItems.itemId, ids)));
    }
  });
  return { ok: true };
});
