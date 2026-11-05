import { eq } from "drizzle-orm";
import { db } from "@/db";
import { personalGanttWorkspaces } from "@/db/schema";
import { requireSuper } from "@/server/auth";
import { loadCatalog } from "@/server/catalog";
import { ApiError, body, route } from "@/server/errors";
import { applyPrivateCommand, emptyPrivateState, privateCommandSchema, PrivateError } from "@/lib/privateWorkspace";

async function ensure(userId: number) {
  await db.insert(personalGanttWorkspaces).values({ userId, state: emptyPrivateState() }).onConflictDoNothing();
}
function toPlan(row: typeof personalGanttWorkspaces.$inferSelect) {
  return { version: row.version, rows: row.state.rows, items: row.state.items, deletedItems: row.state.deletedItems };
}
export const GET = route(async () => {
  const me = await requireSuper();
  await ensure(me.id);
  const [row] = await db.select().from(personalGanttWorkspaces).where(eq(personalGanttWorkspaces.userId, me.id));
  return toPlan(row);
});
export const POST = route(async (req) => {
  const me = await requireSuper();
  const command = privateCommandSchema.parse(await body(req));
  const cat = await loadCatalog();
  await ensure(me.id);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(personalGanttWorkspaces).where(eq(personalGanttWorkspaces.userId, me.id)).for("update");
      const { state, result } = applyPrivateCommand(row.state, command, cat, me.id);
      const [updated] = await tx.update(personalGanttWorkspaces).set({ state, version: row.version + 1 })
        .where(eq(personalGanttWorkspaces.userId, me.id)).returning();
      return { plan: toPlan(updated), result };
    });
  } catch (e) {
    if (e instanceof PrivateError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
