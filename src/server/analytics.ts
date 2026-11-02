import "server-only";
// אנליטיקות שימוש (ניהול מערכת, מנהל המערכת בלבד).
// מקורות: user_activity (מי היה במערכת ומתי — נאסף מאז שהתכונה נוספה) ו-audit_logs (כל שינוי בתוכנית — מאז ומעולם).
import { and, asc, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, domains, teams, userActivity, users, workItems } from "@/db/schema";
import type { Me } from "@/lib/types";
import { daysDiff, todayIL } from "@/lib/weeks";
import { bucketOf, bucketsBetween, granularityFor, type Granularity } from "@/lib/analyticsBuckets";
export type { Granularity };
import { ApiError } from "./errors";

export type AnalyticsData = {
  from: string; to: string; granularity: Granularity; trackingSince: string | null;
  kpis: { activeUsers: number; approvedUsers: number; visits: number; logins: number; avgDailyActive: number; changes: number; itemsCreated: number; aiUsers: number };
  series: { bucket: string; activeUsers: number; visits: number; changes: number }[];
  users: { id: number; name: string; role: string; activeDays: number; visits: number; logins: number; aiDays: number; changes: number; itemsCreated: number; lastSeen: string | null }[];
  byDomain: { name: string; changes: number }[];
  changeTypes: { key: string; label: string; count: number }[];
  teams: { id: number; name: string; domain: string; items: number; lastUpdate: string | null; daysSince: number | null }[];
};

const PLAN_ENTITIES = ["item", "milestone", "sprint", "row", "import"];
const TYPE_LABELS: Record<string, string> = {
  "item:create": "תכולות חדשות", "item:update": "עדכוני תכולות", "item:delete": "מחיקת תכולות", "item:restore": "שחזור תכולות",
  "milestone:create": "אבני דרך חדשות", "milestone:update": "עדכוני אבני דרך", "milestone:delete": "מחיקת אבני דרך",
  "sprint:create": "ספרינטים חדשים", "sprint:update": "עדכוני ספרינטים", "sprint:delete": "מחיקת ספרינטים",
  "row:create": "שורות חדשות", "row:delete": "מחיקת שורות", "import:create": "ייבוא בעזרת AI", "snapshot:create": "תמונות מצב חדשות",
};

export async function loadAnalytics(me: Me, from: string, to: string): Promise<AnalyticsData> {
  if (me.role !== "SUPER") throw new ApiError(403, "פעולה זו זמינה למנהל המערכת בלבד");
  if (to < from) [from, to] = [to, from];
  const today = todayIL();
  if (to > today) to = today;
  if (daysDiff(from, to) > 366 * 3) throw new ApiError(400, "טווח של עד 3 שנים");
  const g = granularityFor(from, to);
  const ilDay = sql`(${auditLogs.at} AT TIME ZONE 'Asia/Jerusalem')::date`;

  const [act, lastSeenRows, since, audit, people, itemTeams, ds, ts, teamStats] = await Promise.all([
    db.select().from(userActivity).where(and(gte(userActivity.day, from), lte(userActivity.day, to))),
    db.select({ userId: userActivity.userId, last: sql<string>`max(${userActivity.lastSeenAt})` }).from(userActivity).groupBy(userActivity.userId),
    db.select({ d: sql<string | null>`min(${userActivity.day})::text` }).from(userActivity),
    db.select({ userId: auditLogs.userId, type: auditLogs.entityType, action: auditLogs.action, entityId: auditLogs.entityId, day: sql<string>`${ilDay}::text` })
      .from(auditLogs).where(and(isNotNull(auditLogs.userId), sql`${ilDay} BETWEEN ${from}::date AND ${to}::date`,
        sql`${auditLogs.entityType} IN (${sql.join([...PLAN_ENTITIES, "snapshot"].map((x) => sql`${x}`), sql`, `)})`)),
    db.select({ id: users.id, name: users.fullName, role: users.role }).from(users).where(isNotNull(users.approvedAt)).orderBy(asc(users.fullName)),
    db.select({ id: workItems.id, teamId: workItems.teamId }).from(workItems),
    db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(asc(domains.sortOrder)),
    db.select({ id: teams.id, name: teams.name, domainId: teams.domainId }).from(teams).where(isNull(teams.archivedAt)).orderBy(asc(teams.sortOrder)),
    db.select({ teamId: workItems.teamId, n: sql<number>`count(*)::int`, last: sql<string | null>`max(${workItems.updatedAt})` })
      .from(workItems).where(isNull(workItems.deletedAt)).groupBy(workItems.teamId),
  ]);

  const planChanges = audit.filter((a) => PLAN_ENTITIES.includes(a.type));
  const buckets = bucketsBetween(from, to, g);
  const series = buckets.map((b) => {
    const inB = (day: string) => bucketOf(day, g) === b;
    const a = act.filter((x) => inB(x.day));
    return { bucket: b, activeUsers: new Set(a.map((x) => x.userId)).size, visits: a.reduce((s, x) => s + x.visits, 0), changes: planChanges.filter((x) => inB(x.day)).length };
  });
  // ממוצע משתמשים פעילים ביום — על הימים שבטווח
  const perDay = new Map<string, Set<number>>();
  for (const x of act) { if (!perDay.has(x.day)) perDay.set(x.day, new Set()); perDay.get(x.day)!.add(x.userId); }
  const nDays = daysDiff(from, to) + 1;
  const avgDailyActive = Math.round(([...perDay.values()].reduce((s, v) => s + v.size, 0) / nDays) * 10) / 10;

  const lastSeen = new Map(lastSeenRows.map((r) => [r.userId, r.last]));
  const userRows = people.map((p) => {
    const a = act.filter((x) => x.userId === p.id), c = planChanges.filter((x) => x.userId === p.id);
    return {
      id: p.id, name: p.name, role: p.role,
      activeDays: new Set(a.map((x) => x.day)).size, visits: a.reduce((s, x) => s + x.visits, 0), logins: a.reduce((s, x) => s + x.logins, 0),
      aiDays: new Set(a.filter((x) => x.source === "mcp").map((x) => x.day)).size,
      changes: c.length, itemsCreated: c.filter((x) => x.type === "item" && x.action === "create").length,
      lastSeen: lastSeen.get(p.id) ? new Date(lastSeen.get(p.id)!).toISOString() : null,
    };
  }).sort((a, b) => b.activeDays - a.activeDays || b.changes - a.changes || a.name.localeCompare(b.name, "he"));

  // שינויים בתכולות לפי תחום (לפי הצוות הנוכחי של התכולה; תכולה רוחבית — "רוחבי")
  const itemTeam = new Map(itemTeams.map((i) => [i.id, i.teamId]));
  const teamDomain = new Map(ts.map((t) => [t.id, t.domainId]));
  const domainCount = new Map<string, number>();
  for (const c of planChanges.filter((x) => x.type === "item")) {
    const t = itemTeam.get(Number(c.entityId));
    if (t === undefined) continue;
    const name = t === null ? "רוחבי" : ds.find((d) => d.id === teamDomain.get(t))?.name;
    if (name) domainCount.set(name, (domainCount.get(name) ?? 0) + 1);
  }
  const byDomain = [...ds.map((d) => d.name), "רוחבי"].map((name) => ({ name, changes: domainCount.get(name) ?? 0 }))
    .filter((d) => d.changes > 0 || d.name !== "רוחבי").sort((a, b) => b.changes - a.changes);

  const typeCount = new Map<string, number>();
  for (const c of audit) { const k = `${c.type}:${c.action}`; if (TYPE_LABELS[k]) typeCount.set(k, (typeCount.get(k) ?? 0) + 1); }
  const changeTypes = Object.entries(TYPE_LABELS).map(([key, label]) => ({ key, label, count: typeCount.get(key) ?? 0 })).filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  const stats = new Map(teamStats.map((s) => [s.teamId, s]));
  const teamRows = ts.map((t) => {
    const s = stats.get(t.id), last = s?.last ? new Date(s.last).toISOString() : null;
    return { id: t.id, name: t.name, domain: ds.find((d) => d.id === t.domainId)?.name ?? "", items: s?.n ?? 0, lastUpdate: last, daysSince: last ? daysDiff(last.slice(0, 10), today) : null };
  }).sort((a, b) => (b.daysSince ?? 1e9) - (a.daysSince ?? 1e9));

  return {
    from, to, granularity: g, trackingSince: since[0]?.d ?? null,
    kpis: {
      activeUsers: new Set(act.map((x) => x.userId)).size, approvedUsers: people.length,
      visits: act.reduce((s, x) => s + x.visits, 0), logins: act.reduce((s, x) => s + x.logins, 0), avgDailyActive,
      changes: planChanges.length, itemsCreated: planChanges.filter((x) => x.type === "item" && x.action === "create").length,
      aiUsers: new Set(act.filter((x) => x.source === "mcp").map((x) => x.userId)).size,
    },
    series, users: userRows, byDomain, changeTypes, teams: teamRows,
  };
}
