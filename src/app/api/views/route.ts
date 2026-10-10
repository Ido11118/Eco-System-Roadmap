import { asc, eq } from "drizzle-orm";
import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { savedViewSchema } from "@/lib/validation";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
export const GET = route(async () => {
  const me = await requireApproved();
  return db.select().from(savedViews).where(eq(savedViews.userId, me.id)).orderBy(asc(savedViews.name));
});
export const POST = route(async (req) => {
  const me = await requireApproved();
  const v = savedViewSchema.parse(await body(req));
  return db.transaction(async (tx) => {
    if (v.isDefault) await tx.update(savedViews).set({ isDefault: false }).where(eq(savedViews.userId, me.id));
    const [row] = await tx.insert(savedViews).values({ userId: me.id, name: v.name, config: v.config, isDefault: !!v.isDefault })
      .onConflictDoUpdate({ target: [savedViews.userId, savedViews.name], set: { config: v.config, updatedAt: new Date(), ...(v.isDefault ? { isDefault: true } : {}) } })
      .returning();
    return row;
  });
});
