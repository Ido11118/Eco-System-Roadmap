import { eq, sql } from "drizzle-orm";
import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { preferencesSchema } from "@/lib/validation";
import { db } from "@/db";
import { users } from "@/db/schema";
export const PATCH = route(async (req) => {
  const me = await requireApproved();
  const patch = preferencesSchema.parse(await body(req));
  // מיזוג אטומי בבסיס הנתונים — שתי שמירות מקבילות של שדות שונים לא דורסות זו את זו
  const [row] = await db.update(users).set({ preferences: sql`${users.preferences} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(users.id, me.id)).returning({ preferences: users.preferences });
  return row.preferences;
});
