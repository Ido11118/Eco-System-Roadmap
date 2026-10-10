import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { route, body, intParam, ApiError } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { viewConfigSchema } from "@/lib/validation";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
const patchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), isDefault: z.boolean().optional(), config: viewConfigSchema.optional() });
export const PATCH = route(async (req, ctx) => {
  const me = await requireApproved();
  const id = intParam((await ctx.params).id);
  const v = patchSchema.parse(await body(req));
  return db.transaction(async (tx) => {
    if (v.isDefault) await tx.update(savedViews).set({ isDefault: false }).where(eq(savedViews.userId, me.id));
    const [row] = await tx.update(savedViews).set({ ...v, updatedAt: new Date() })
      .where(and(eq(savedViews.id, id), eq(savedViews.userId, me.id))).returning();
    if (!row) throw new ApiError(404, "התצוגה לא נמצאה");
    return row;
  });
});
export const DELETE = route(async (_req, ctx) => {
  const me = await requireApproved();
  const id = intParam((await ctx.params).id);
  const r = await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, me.id))).returning();
  if (!r.length) throw new ApiError(404, "התצוגה לא נמצאה");
  return { ok: true };
});
