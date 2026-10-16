import { asc } from "drizzle-orm";
import { route, body } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { permissionRequestSchema } from "@/lib/validation";
import { myOpenRequests, requestPermissions } from "@/server/requests";
import { db } from "@/db";
import { domains } from "@/db/schema";
// הגדרות משתמש: התחומים (להצגת ההרשאות) והפניות הפתוחות שלו
export const GET = route(async () => {
  const me = await requireApproved();
  const [requests, ds] = await Promise.all([
    myOpenRequests(me),
    db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(asc(domains.sortOrder)),
  ]);
  return { requests, domains: ds };
});
export const POST = route(async (req) => {
  const me = await requireApproved();
  return requestPermissions(me, permissionRequestSchema.parse(await body(req)));
});
