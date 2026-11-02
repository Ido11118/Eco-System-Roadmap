import "server-only";
// מעקב פעילות לאנליטיקות: מי היה במערכת, באיזה יום, כמה ביקורים, ומאיפה (אתר / Claude דרך MCP).
// לא נשמר מה המשתמש ראה — רק מונים. כתיבה לבסיס הנתונים לכל היותר פעם ב-5 דקות למשתמש (לא בכל בקשה).
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { userActivity, users } from "@/db/schema";
import { todayIL } from "@/lib/weeks";

const THROTTLE_MS = 5 * 60000;
const VISIT_GAP = "30 minutes"; // פעילות אחרי הפסקה כזו = ביקור חדש
const lastWrite = new Map<string, number>();

export type ActivitySource = "web" | "mcp";

/** רישום פעילות (בלי להמתין ובלי לזרוק — כשל כאן לעולם לא משפיע על הבקשה עצמה) */
export function trackActivity(userId: number, source: ActivitySource = "web") {
  const key = `${userId}:${source}`, now = Date.now();
  if (now - (lastWrite.get(key) ?? 0) < THROTTLE_MS) return;
  lastWrite.set(key, now);
  void upsert(userId, source, false).catch((e) => console.error("[activity]", e));
}

/** התחברות (סיסמה / Google) של משתמש מאושר — נספרת תמיד, ופותחת ביקור חדש. הרשמה / התחברות של ממתין לאישור לא נספרות */
export async function trackLogin(userId: number) {
  try {
    const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (u?.status !== "APPROVED") return;
    lastWrite.set(`${userId}:web`, Date.now());
    await upsert(userId, "web", true);
  } catch (e) { console.error("[activity]", e); }
}

async function upsert(userId: number, source: ActivitySource, login: boolean) {
  await db.insert(userActivity).values({ userId, day: todayIL(), source, visits: 1, logins: login ? 1 : 0 })
    .onConflictDoUpdate({
      target: [userActivity.userId, userActivity.day, userActivity.source],
      set: {
        visits: login ? sql`${userActivity.visits} + 1`
          : sql`${userActivity.visits} + CASE WHEN now() - ${userActivity.lastSeenAt} > interval '${sql.raw(VISIT_GAP)}' THEN 1 ELSE 0 END`,
        logins: sql`${userActivity.logins} + ${login ? 1 : 0}`,
        lastSeenAt: sql`now()`,
      },
    });
}
