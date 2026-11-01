import "server-only";
// שרת ה-MCP: הכלים שעוזר AI (Claude / ChatGPT) מקבל לתוכנית העבודה.
// כל כלי קורא לאותן פונקציות שרת שהממשק משתמש בהן — כך ההרשאות לפי תחום, נעילות הגרסה, בדיקות החפיפה וההיסטוריה זהים.
// חיבור "קריאה בלבד" מקבל רק את כלי הקריאה. מחיקה — לא קיימת ב-MCP בכלל.
import crypto from "crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Dependency, ItemDTO, Me, PlanData } from "@/lib/types";
import type { Catalog } from "@/lib/catalog";
import { CROSS_ROW_LABELS } from "@/lib/constants";
import { placeTeamItems } from "@/lib/aiImport";
import { importSchema } from "@/lib/validation";
import { addWeeks, currentWeekIL, todayIL, weekStartOf, type ISODate } from "@/lib/weeks";
import { itemOut, overlaps, parseDate, parseWeek, placeOf, weekInfo, weekTag } from "@/lib/mcpFormat";
import type { Access } from "@/lib/oauth";
import { db } from "@/db";
import { ApiError } from "./errors";
import { loadCatalog } from "./catalog";
import {
  bulkUpdateItems, canEditCross, createMilestone, createRow, createSprint, itemHistory, loadPlan, updateItem, updateMilestone, updateSprint,
  type ItemPatch,
} from "./plan";
import { importPlan } from "./aiImport";
import { createBacklog, listBacklog, scheduleBacklog, updateBacklog } from "./backlog";
import { appUrl } from "./google";

const INSTRUCTIONS = `This server gives access to an organization's work plan ("תוכנית עבודה"): a Gantt chart of work items ("תכולות") grouped by domain ("תחום") and team ("צוות"), plus milestones ("אבני דרך"), sprints ("ספרינטים") and a backlog ("באקלוג").
Content is in Hebrew — answer the user in the language they use.
Start with get_overview: it returns the structure (domain/team ids), status and priority keys, the current week, and what this user may edit.
Time is measured in weeks (Sunday–Saturday). Week numbering is the organization's: week 1 of a year is the week that contains January 1st. Pass weeks as a date (YYYY-MM-DD, any day of that week) or as "N/YYYY" (e.g. "12/2026"); use convert_weeks when unsure.
All actions run with the permissions of the connected user and are recorded in the item history under their name. Deleting is not possible through this connection — if the user asks to delete, tell them to do it in the app (or set the status to cancelled if that fits).`;

type Ctx = { me: Me; access: Access; clientName: string };

const ok = (x: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(x, null, 1) }] });
const fail = (msg: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: msg }] });

/** הרצת כלי עם הודעת שגיאה ברורה לעוזר (במקום חריגה) */
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try { return ok(await fn()); }
  catch (e) {
    if (e instanceof ApiError) return fail(e.message);
    if (e instanceof z.ZodError) return fail(e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
    const pg = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
    if (pg === "23P01") return fail("הטווח חופף לתכולה אחרת באותה שורה.");
    if (pg === "40P01" || pg === "40001") return fail("התנגשות עם עדכון מקביל. נסה שוב.");
    if (pg === "23503" || pg === "23514") return fail("הנתונים אינם תקינים (הפניה לרשומה שאינה קיימת או ערך לא חוקי).");
    if (e instanceof Error && !pg) return fail(e.message);
    console.error(e);
    return fail("שגיאת שרת. נסה שוב.");
  }
}

async function snapshot() {
  const [data, cat] = await Promise.all([loadPlan(db), loadCatalog()]);
  return { data, cat };
}

function findItem(data: PlanData, id: number) {
  const it = data.items.find((i) => i.id === id);
  if (!it) throw new ApiError(404, `תכולה ${id} לא נמצאה (ייתכן שנמחקה).`);
  return it;
}

function canEditTeamSync(me: Me, data: PlanData, teamId: number) {
  const t = data.teams.find((x) => x.id === teamId);
  return !!t && (me.role === "SUPER" || me.domainIds.includes(t.domainId));
}

function resolveStatus(cat: Catalog, v?: string) {
  if (v === undefined) return undefined;
  const s = cat.statuses.find((x) => x.key === v || x.label === v.trim());
  if (!s) throw new ApiError(400, `סטטוס לא קיים: "${v}". אפשרויות: ${cat.statuses.map((x) => `${x.key} (${x.label})`).join(", ")}`);
  return s.key;
}
function resolvePriority(cat: Catalog, v?: string) {
  if (v === undefined) return undefined;
  const p = cat.priorities.find((x) => x.key === v || x.label === v.trim());
  if (!p) throw new ApiError(400, `תיעדוף לא קיים: "${v}". אפשרויות: ${cat.priorities.map((x) => `${x.key} (${x.label})`).join(", ")}`);
  return p.key;
}

/** שורה פנויה בצוות לטווח (ואם אין — שורה חדשה), כמו בייבוא בעזרת AI */
async function rowInTeam(me: Me, data: PlanData, teamId: number, start: ISODate, end: ISODate, exceptItemId?: number) {
  const live = data.items.filter((i) => i.teamId === teamId && i.id !== exceptItemId);
  const [pl] = placeTeamItems(data.rows, live, [{ teamId, startWeek: start, endWeek: end }]);
  if ("rowId" in pl) return pl.rowId;
  return (await createRow(me, teamId)).id;
}

const depsSchema = z.array(z.object({
  text: z.string().describe("What needs to happen"),
  on: z.string().optional().describe("Who it depends on (team / person / external party)"),
  done: z.boolean().optional(),
})).max(30);
function toDeps(list: z.infer<typeof depsSchema>, prev: Dependency[] = []): Dependency[] {
  return list.map((d) => {
    const same = prev.find((p) => p.text === d.text.trim());
    return { id: same?.id ?? crypto.randomUUID().slice(0, 12), text: d.text.trim(), on: (d.on ?? "").trim(), done: d.done ?? same?.done ?? false };
  });
}

const weekArg = (what: string) => z.string().describe(`${what}: date YYYY-MM-DD (any day of the week) or week number "N/YYYY"`);
const optWeek = (what: string) => weekArg(what).optional();

export function buildMcpServer(ctx: Ctx): McpServer {
  const { me } = ctx;
  const server = new McpServer({ name: "workplan", title: "תוכנית עבודה", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
  const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const base = appUrl();

  // =========================================================================
  // קריאה
  // =========================================================================

  server.registerTool("get_overview", {
    title: "Plan overview",
    description: "Structure of the work plan (domains and teams with ids), cross rows, status and priority keys, the current week and week-numbering rules, and what the connected user may edit. Call this first.",
    inputSchema: {}, annotations: RO,
  }, async () => run(async () => {
    const { data, cat } = await snapshot();
    const cw = currentWeekIL();
    const backlog = await listBacklog(me);
    return {
      today: todayIL(), current_week: weekInfo(cw),
      week_rules: "Weeks run Sunday to Saturday. Week 1 of a year is the week that contains January 1st (so it may start in late December). Items span whole weeks.",
      you: {
        name: me.fullName, email: me.email, connection_access: ctx.access === "write" ? "read and edit (no delete)" : "read only",
        is_admin: me.role === "SUPER",
        can_edit_domains: me.role === "SUPER" ? "all" : data.domains.filter((d) => me.domainIds.includes(d.id)).map((d) => d.name),
        can_edit_cross_rows: canEditCross(me),
      },
      domains: data.domains.map((d) => ({
        id: d.id, name: d.name,
        teams: data.teams.filter((t) => t.domainId === d.id).map((t) => ({ id: t.id, name: t.name })),
      })),
      cross_rows: (["INFLUENCE", "CROSS_EVENT"] as const).map((k) => ({ key: k, name: CROSS_ROW_LABELS[k] })),
      statuses: cat.statuses.map((s) => ({ key: s.key, label: s.label, meaning: s.category })),
      priorities: cat.priorities.map((p) => ({ key: p.key, label: p.label })),
      default_status: cat.defaultStatus, default_priority: cat.defaultPriority,
      counts: { items: data.items.length, milestones: data.milestones.length, sprints: data.sprints.length, backlog: backlog.length },
      app_url: `${base}/plan`,
    };
  }));

  server.registerTool("search_items", {
    title: "Search work items",
    description: "Find work items (תכולות) on the Gantt. All filters are optional and combined with AND. Returns up to `limit` items sorted by start week.",
    inputSchema: {
      query: z.string().optional().describe("Free text: matched against name, notes and dependencies; or an item id"),
      domain_ids: z.array(z.number().int()).optional(),
      team_ids: z.array(z.number().int()).optional(),
      statuses: z.array(z.string()).optional().describe("Status keys or labels"),
      priorities: z.array(z.string()).optional().describe("Priority keys or labels"),
      from: optWeek("Only items that end on/after this week"),
      to: optWeek("Only items that start on/before this week"),
      include_cross_rows: z.boolean().optional().describe("Include cross-organization rows (holidays, events). Default: true unless domain/team filters are given"),
      limit: z.number().int().min(1).max(300).optional().describe("Default 50"),
    },
    annotations: RO,
  }, async (a) => run(async () => {
    const { data, cat } = await snapshot();
    const from = a.from ? parseWeek(a.from) : undefined, to = a.to ? parseWeek(a.to) : undefined;
    const st = a.statuses?.map((s) => resolveStatus(cat, s)!), pr = a.priorities?.map((p) => resolvePriority(cat, p)!);
    const q = a.query?.trim().toLowerCase();
    const scoped = !!(a.domain_ids?.length || a.team_ids?.length);
    const cross = a.include_cross_rows ?? !scoped;
    const teamDomain = new Map(data.teams.map((t) => [t.id, t.domainId]));
    const list = data.items.filter((i) => {
      if (i.teamId === null) { if (!cross) return false; }
      else {
        if (a.team_ids?.length && !a.team_ids.includes(i.teamId)) return false;
        if (a.domain_ids?.length && !a.domain_ids.includes(teamDomain.get(i.teamId) ?? -1)) return false;
      }
      if (st && !st.includes(i.status)) return false;
      if (pr && !pr.includes(i.priority)) return false;
      if (!overlaps(i, from, to)) return false;
      if (q && String(i.id) !== q && !i.name.toLowerCase().includes(q) && !i.notes.toLowerCase().includes(q)
        && !(i.dependencies ?? []).some((d) => d.text.toLowerCase().includes(q) || d.on.toLowerCase().includes(q))) return false;
      return true;
    }).sort((x, y) => x.startWeek.localeCompare(y.startWeek) || x.id - y.id);
    const limit = a.limit ?? 50;
    return { total: list.length, returned: Math.min(limit, list.length), items: list.slice(0, limit).map((i) => itemOut(data, cat, i)) };
  }));

  server.registerTool("get_item", {
    title: "Get work item",
    description: "Full details of one work item, optionally with its change history.",
    inputSchema: { id: z.number().int(), include_history: z.boolean().optional().describe("Default false") },
    annotations: RO,
  }, async (a) => run(async () => {
    const { data, cat } = await snapshot();
    const it = findItem(data, a.id);
    const out: Record<string, unknown> = itemOut(data, cat, it, base);
    if (a.include_history) {
      out.history = (await itemHistory("item", a.id)).slice(0, 30).map((h) => ({ at: h.at, by: h.userName, action: h.action, summary: h.summary }));
    }
    return out;
  }));

  server.registerTool("list_milestones", {
    title: "List milestones",
    description: "Milestones (אבני דרך): of a team, of a whole domain, or organization-wide.",
    inputSchema: {
      from: z.string().optional().describe("YYYY-MM-DD"), to: z.string().optional().describe("YYYY-MM-DD"),
      domain_id: z.number().int().optional().describe("Milestones of this domain and of its teams"),
      team_id: z.number().int().optional(),
    },
    annotations: RO,
  }, async (a) => run(async () => {
    const { data } = await snapshot();
    const from = a.from ? parseDate(a.from) : undefined, to = a.to ? parseDate(a.to) : undefined;
    const teamDomain = new Map(data.teams.map((t) => [t.id, t.domainId]));
    return data.milestones.filter((m) => (!from || m.date >= from) && (!to || m.date <= to)
      && (a.team_id === undefined || m.teamId === a.team_id)
      && (a.domain_id === undefined || m.domainId === a.domain_id || (m.teamId !== null && teamDomain.get(m.teamId) === a.domain_id)))
      .map((m) => ({
        id: m.id, name: m.name, date: m.date, week: weekTag(weekStartOf(m.date)),
        scope: m.teamId !== null ? `team: ${data.teams.find((t) => t.id === m.teamId)?.name}` : m.domainId !== null ? `domain: ${data.domains.find((d) => d.id === m.domainId)?.name}` : "organization-wide",
        team_id: m.teamId, domain_id: m.domainId, ...(m.notes ? { notes: m.notes } : {}),
      }));
  }));

  server.registerTool("list_sprints", {
    title: "List sprints",
    description: "Sprints (ספרינטים) of each domain.",
    inputSchema: { from: z.string().optional().describe("YYYY-MM-DD"), to: z.string().optional().describe("YYYY-MM-DD"), domain_id: z.number().int().optional() },
    annotations: RO,
  }, async (a) => run(async () => {
    const { data } = await snapshot();
    const from = a.from ? parseDate(a.from) : undefined, to = a.to ? parseDate(a.to) : undefined;
    return data.sprints.filter((s) => (!from || s.endDate >= from) && (!to || s.startDate <= to) && (a.domain_id === undefined || s.domainId === a.domain_id))
      .map((s) => ({ id: s.id, name: s.name, start_date: s.startDate, end_date: s.endDate, domain: data.domains.find((d) => d.id === s.domainId)?.name, domain_id: s.domainId, ...(s.notes ? { notes: s.notes } : {}) }));
  }));

  server.registerTool("list_backlog", {
    title: "List backlog",
    description: "Backlog items (not yet scheduled on the Gantt) in the domains the user can access.",
    inputSchema: { domain_id: z.number().int().optional(), team_id: z.number().int().optional(), query: z.string().optional() },
    annotations: RO,
  }, async (a) => run(async () => {
    const [{ data, cat }, list] = await Promise.all([snapshot(), listBacklog(me)]);
    const q = a.query?.trim().toLowerCase();
    return list.filter((b) => (a.domain_id === undefined || b.domainId === a.domain_id) && (a.team_id === undefined || b.teamId === a.team_id)
      && (!q || b.name.toLowerCase().includes(q) || b.notes.toLowerCase().includes(q) || String(b.id) === q))
      .map((b) => ({
        id: b.id, name: b.name, domain: data.domains.find((d) => d.id === b.domainId)?.name, domain_id: b.domainId,
        team: data.teams.find((t) => t.id === b.teamId)?.name, team_id: b.teamId, priority: cat.priority(b.priority).label, priority_key: b.priority,
        ...(b.notes ? { notes: b.notes } : {}),
      }));
  }));

  server.registerTool("convert_weeks", {
    title: "Convert weeks",
    description: "Convert dates or organization week numbers to weeks (number, Sunday, Saturday). Useful because week 1 is the week containing January 1st.",
    inputSchema: { values: z.array(z.string()).min(1).max(50).describe('Dates "YYYY-MM-DD" or week numbers "N/YYYY"') },
    annotations: RO,
  }, async (a) => run(async () => a.values.map((v) => {
    try { return { input: v, ...weekInfo(parseWeek(v)) }; } catch (e) { return { input: v, error: (e as Error).message }; }
  })));

  if (ctx.access !== "write") return server;

  // =========================================================================
  // עריכה (רק בחיבור "קריאה ועריכה"). אין כלי מחיקה.
  // =========================================================================

  server.registerTool("create_items", {
    title: "Create work items",
    description: "Add work items to the Gantt (all or nothing). Each item goes to a team (placed automatically on a free row; a new row is added if needed) or to a cross row (INFLUENCE / CROSS_EVENT).",
    inputSchema: {
      items: z.array(z.object({
        name: z.string(),
        team_id: z.number().int().optional().describe("Team id (from get_overview). Omit when using cross_row"),
        cross_row: z.enum(["INFLUENCE", "CROSS_EVENT"]).optional().describe("Cross-organization row instead of a team"),
        start: weekArg("First week"), end: weekArg("Last week (inclusive)"),
        status: z.string().optional(), priority: z.string().optional(), notes: z.string().optional(),
      })).min(1).max(100),
    },
    annotations: RW,
  }, async (a) => run(async () => {
    const { data, cat } = await snapshot();
    const items = a.items.map((x) => {
      if ((x.team_id === undefined) === (x.cross_row === undefined)) throw new ApiError(400, `"${x.name}": יש לציין team_id או cross_row (אחד מהם).`);
      return {
        name: x.name, teamId: x.team_id ?? null, cross: x.cross_row ?? null, startWeek: parseWeek(x.start), endWeek: parseWeek(x.end),
        status: resolveStatus(cat, x.status), priority: resolvePriority(cat, x.priority), notes: x.notes ?? "",
      };
    });
    const payload = importSchema.parse({ items, milestones: [], sprints: [], backlog: [] });
    const res = await importPlan(me, payload, { tag: "" });
    const fresh = await loadPlan(db);
    return { created: res.itemIds.map((id) => itemOut(fresh, cat, findItem(fresh, id), base)), new_rows: res.rowIds.length };
  }));

  server.registerTool("update_item", {
    title: "Update work item",
    description: "Change a work item: name, status, priority, notes, dates (start/end week), team (moves it to a free row in that team), or dependencies (replaces the list). Only the fields you pass are changed.",
    inputSchema: {
      id: z.number().int(),
      name: z.string().optional(), status: z.string().optional(), priority: z.string().optional(), notes: z.string().optional(),
      start: optWeek("New first week"), end: optWeek("New last week (inclusive)"),
      team_id: z.number().int().optional().describe("Move to another team"),
      dependencies: depsSchema.optional().describe("Full new list of dependencies (replaces the existing list)"),
    },
    annotations: RW,
  }, async (a) => run(async () => {
    const { data, cat } = await snapshot();
    const cur = findItem(data, a.id);
    const patch: ItemPatch = {};
    if (a.name !== undefined) patch.name = a.name.trim();
    if (a.status !== undefined) patch.status = resolveStatus(cat, a.status);
    if (a.priority !== undefined) patch.priority = resolvePriority(cat, a.priority);
    if (a.notes !== undefined) patch.notes = a.notes;
    if (a.start !== undefined) patch.startWeek = parseWeek(a.start);
    if (a.end !== undefined) patch.endWeek = parseWeek(a.end);
    if (a.dependencies !== undefined) patch.dependencies = toDeps(a.dependencies, cur.dependencies);
    const start = patch.startWeek ?? cur.startWeek, end = patch.endWeek ?? cur.endWeek;
    if (end < start) throw new ApiError(400, "שבוע הסיום לפני שבוע ההתחלה.");
    if (a.team_id !== undefined && a.team_id !== cur.teamId) {
      if (cur.teamId === null) throw new ApiError(400, "לא ניתן להעביר תכולה משורה רוחבית לצוות.");
      if (!canEditTeamSync(me, data, a.team_id)) throw new ApiError(403, "אין לך הרשאת עריכה לצוות היעד.");
      patch.rowId = await rowInTeam(me, data, a.team_id, start, end, cur.id);
    } else if ((patch.startWeek || patch.endWeek) && cur.teamId !== null) {
      // שינוי תאריכים שמתנגש בתכולה אחרת באותה שורה → מעבר לשורה פנויה באותו צוות (כמו בגרירה לשורה אחרת)
      const clash = data.items.some((i) => i.rowId === cur.rowId && i.id !== cur.id && i.startWeek <= end && i.endWeek >= start);
      if (clash) patch.rowId = await rowInTeam(me, data, cur.teamId, start, end, cur.id);
    }
    const upd = await updateItem(me, cur.id, cur.version, patch);
    return { updated: itemOut(await loadPlan(db), cat, upd, base) };
  }));

  server.registerTool("update_items", {
    title: "Update several work items",
    description: "Set the status and/or priority of several work items at once (all or nothing).",
    inputSchema: { ids: z.array(z.number().int()).min(1).max(300), status: z.string().optional(), priority: z.string().optional() },
    annotations: RW,
  }, async (a) => run(async () => {
    const { data, cat } = await snapshot();
    if (a.status === undefined && a.priority === undefined) throw new ApiError(400, "יש לציין status או priority.");
    const entries = a.ids.map((id) => ({ id, version: findItem(data, id).version }));
    const out = await bulkUpdateItems(me, entries, { status: resolveStatus(cat, a.status), priority: resolvePriority(cat, a.priority) });
    return { updated: out.length };
  }));

  server.registerTool("shift_items", {
    title: "Shift work items in time",
    description: "Move work items earlier or later by a number of weeks, keeping their length (all or nothing). Items that would collide with another item on their row are moved to a free row of the same team.",
    inputSchema: { ids: z.array(z.number().int()).min(1).max(300), weeks: z.number().int().min(-104).max(104).refine((n) => n !== 0, "weeks must not be 0").describe("Positive = later, negative = earlier") },
    annotations: RW,
  }, async (a) => run(async () => {
    const { data, cat } = await snapshot();
    const items = [...new Set(a.ids)].map((id) => findItem(data, id));
    // סדר ההזזה: מהקצה בכיוון התנועה — כך תכולות סמוכות באותה שורה לא מתנגשות זו בזו בדרך
    items.sort((x, y) => (a.weeks > 0 ? y.startWeek.localeCompare(x.startWeek) : x.startWeek.localeCompare(y.startWeek)));
    const moving = new Set(items.map((i) => i.id));
    const occupied = data.items.filter((i) => !moving.has(i.id)); // מצב השורות אחרי ההזזה (מתעדכן תוך כדי)
    const plan: { item: ItemDTO; patch: ItemPatch }[] = [];
    for (const it of items) {
      const start = addWeeks(it.startWeek, a.weeks), end = addWeeks(it.endWeek, a.weeks);
      const patch: ItemPatch = { startWeek: start, endWeek: end };
      let rowId = it.rowId;
      if (it.teamId !== null && occupied.some((o) => o.rowId === it.rowId && o.startWeek <= end && o.endWeek >= start)) {
        rowId = await rowInTeam(me, { ...data, items: occupied }, it.teamId, start, end, it.id);
        patch.rowId = rowId;
      }
      occupied.push({ ...it, rowId, startWeek: start, endWeek: end });
      plan.push({ item: it, patch });
    }
    await db.transaction(async (tx) => {
      for (const p of plan) await updateItem(me, p.item.id, p.item.version, p.patch, tx, cat);
    });
    const fresh = await loadPlan(db);
    return { shifted: plan.length, items: plan.map((p) => { const i = findItem(fresh, p.item.id); return { id: i.id, name: i.name, start_week: weekTag(i.startWeek), end_week: weekTag(i.endWeek) }; }) };
  }));

  const msScope = {
    team_id: z.number().int().optional().describe("Milestone of a team"),
    domain_id: z.number().int().optional().describe("Milestone of a whole domain"),
  };
  server.registerTool("create_milestone", {
    title: "Create milestone",
    description: "Add a milestone (אבן דרך) on a date: for a team (team_id), for a whole domain (domain_id), or organization-wide (neither).",
    inputSchema: { name: z.string(), date: z.string().describe("YYYY-MM-DD"), ...msScope, notes: z.string().optional() },
    annotations: RW,
  }, async (a) => run(async () => {
    if (a.team_id !== undefined && a.domain_id !== undefined) throw new ApiError(400, "אבן דרך שייכת לצוות או לתחום — לא לשניהם.");
    const m = await createMilestone(me, { name: a.name.trim(), date: parseDate(a.date), teamId: a.team_id ?? null, domainId: a.domain_id ?? null, notes: a.notes });
    return { created: { id: m.id, name: m.name, date: m.date, week: weekTag(weekStartOf(m.date)) } };
  }));

  server.registerTool("update_milestone", {
    title: "Update milestone",
    description: "Change a milestone's name, date, notes, or scope. Only the fields you pass are changed.",
    inputSchema: { id: z.number().int(), name: z.string().optional(), date: z.string().optional().describe("YYYY-MM-DD"), notes: z.string().optional(), ...msScope },
    annotations: RW,
  }, async (a) => run(async () => {
    const { data } = await snapshot();
    const cur = data.milestones.find((m) => m.id === a.id);
    if (!cur) throw new ApiError(404, `אבן דרך ${a.id} לא נמצאה.`);
    const patch: Parameters<typeof updateMilestone>[3] = {};
    if (a.name !== undefined) patch.name = a.name.trim();
    if (a.date !== undefined) patch.date = parseDate(a.date);
    if (a.notes !== undefined) patch.notes = a.notes;
    if (a.team_id !== undefined) { patch.teamId = a.team_id; patch.domainId = null; }
    else if (a.domain_id !== undefined) { patch.domainId = a.domain_id; patch.teamId = null; }
    const m = await updateMilestone(me, a.id, cur.version, patch);
    return { updated: { id: m.id, name: m.name, date: m.date } };
  }));

  server.registerTool("create_sprint", {
    title: "Create sprint",
    description: "Add a sprint (ספרינט) to a domain.",
    inputSchema: { name: z.string(), domain_id: z.number().int(), start_date: z.string().describe("YYYY-MM-DD"), end_date: z.string().describe("YYYY-MM-DD"), notes: z.string().optional() },
    annotations: RW,
  }, async (a) => run(async () => {
    const startDate = parseDate(a.start_date), endDate = parseDate(a.end_date);
    if (endDate < startDate) throw new ApiError(400, "תאריך הסיום לפני תאריך ההתחלה.");
    const s = await createSprint(me, { name: a.name.trim(), domainId: a.domain_id, startDate, endDate, notes: a.notes });
    return { created: { id: s.id, name: s.name, start_date: s.startDate, end_date: s.endDate } };
  }));

  server.registerTool("update_sprint", {
    title: "Update sprint",
    description: "Change a sprint's name, dates, notes or domain. Only the fields you pass are changed.",
    inputSchema: { id: z.number().int(), name: z.string().optional(), start_date: z.string().optional(), end_date: z.string().optional(), domain_id: z.number().int().optional(), notes: z.string().optional() },
    annotations: RW,
  }, async (a) => run(async () => {
    const { data } = await snapshot();
    const cur = data.sprints.find((s) => s.id === a.id);
    if (!cur) throw new ApiError(404, `ספרינט ${a.id} לא נמצא.`);
    const patch: Parameters<typeof updateSprint>[3] = {};
    if (a.name !== undefined) patch.name = a.name.trim();
    if (a.start_date !== undefined) patch.startDate = parseDate(a.start_date);
    if (a.end_date !== undefined) patch.endDate = parseDate(a.end_date);
    if (a.domain_id !== undefined) patch.domainId = a.domain_id;
    if (a.notes !== undefined) patch.notes = a.notes;
    if ((patch.endDate ?? cur.endDate) < (patch.startDate ?? cur.startDate)) throw new ApiError(400, "תאריך הסיום לפני תאריך ההתחלה.");
    const s = await updateSprint(me, a.id, cur.version, patch);
    return { updated: { id: s.id, name: s.name, start_date: s.startDate, end_date: s.endDate } };
  }));

  server.registerTool("create_backlog_item", {
    title: "Create backlog item",
    description: "Add an item to the backlog (not yet scheduled). Give a domain_id, a team_id (its domain is used), or both.",
    inputSchema: { name: z.string(), domain_id: z.number().int().optional(), team_id: z.number().int().optional(), priority: z.string().optional(), notes: z.string().optional() },
    annotations: RW,
  }, async (a) => run(async () => {
    const cat = await loadCatalog();
    if (a.domain_id === undefined && a.team_id === undefined) throw new ApiError(400, "יש לציין domain_id או team_id.");
    const b = await createBacklog(me, { name: a.name.trim(), domainId: a.domain_id, teamId: a.team_id ?? null, priority: resolvePriority(cat, a.priority), notes: a.notes });
    return { created: { id: b.id, name: b.name, domain_id: b.domainId, team_id: b.teamId } };
  }));

  server.registerTool("update_backlog_item", {
    title: "Update backlog item",
    description: "Change a backlog item's name, priority, notes, domain or team. Only the fields you pass are changed.",
    inputSchema: { id: z.number().int(), name: z.string().optional(), priority: z.string().optional(), notes: z.string().optional(), domain_id: z.number().int().optional(), team_id: z.number().int().nullable().optional() },
    annotations: RW,
  }, async (a) => run(async () => {
    const cat = await loadCatalog();
    const cur = (await listBacklog(me)).find((b) => b.id === a.id);
    if (!cur) throw new ApiError(404, `פריט באקלוג ${a.id} לא נמצא.`);
    const b = await updateBacklog(me, a.id, cur.version, {
      ...(a.name !== undefined ? { name: a.name.trim() } : {}), ...(a.priority !== undefined ? { priority: resolvePriority(cat, a.priority) } : {}),
      ...(a.notes !== undefined ? { notes: a.notes } : {}), ...(a.domain_id !== undefined ? { domainId: a.domain_id } : {}),
      ...(a.team_id !== undefined ? { teamId: a.team_id } : {}),
    });
    return { updated: { id: b.id, name: b.name, domain_id: b.domainId, team_id: b.teamId } };
  }));

  server.registerTool("schedule_backlog_item", {
    title: "Schedule backlog item on the Gantt",
    description: "Move a backlog item to the Gantt as a work item (keeps its id), on a team and a range of weeks. The team defaults to the item's team.",
    inputSchema: {
      id: z.number().int(), team_id: z.number().int().optional(), start: weekArg("First week"), end: weekArg("Last week (inclusive)"),
      status: z.string().optional(), priority: z.string().optional(),
    },
    annotations: RW,
  }, async (a) => run(async () => {
    const { data, cat } = await snapshot();
    const b = (await listBacklog(me)).find((x) => x.id === a.id);
    if (!b) throw new ApiError(404, `פריט באקלוג ${a.id} לא נמצא.`);
    const teamId = a.team_id ?? b.teamId;
    if (!teamId) throw new ApiError(400, "לפריט אין צוות — יש לציין team_id.");
    if (!canEditTeamSync(me, data, teamId)) throw new ApiError(403, "אין לך הרשאת עריכה לצוות זה.");
    const start = parseWeek(a.start), end = parseWeek(a.end);
    if (end < start) throw new ApiError(400, "שבוע הסיום לפני שבוע ההתחלה.");
    const rowId = await rowInTeam(me, data, teamId, start, end);
    const it = await scheduleBacklog(me, b.id, b.version, {
      rowId, name: b.name, startWeek: start, endWeek: end, notes: b.notes,
      status: resolveStatus(cat, a.status), priority: resolvePriority(cat, a.priority) ?? b.priority,
    });
    return { scheduled: itemOut(await loadPlan(db), cat, it, base) };
  }));

  return server;
}

/** לבדיקות ולתיעוד: שמות הכלים לפי רמת הגישה */
export const READ_TOOLS = ["get_overview", "search_items", "get_item", "list_milestones", "list_sprints", "list_backlog", "convert_weeks"];
export const WRITE_TOOLS = ["create_items", "update_item", "update_items", "shift_items", "create_milestone", "update_milestone", "create_sprint", "update_sprint", "create_backlog_item", "update_backlog_item", "schedule_backlog_item"];

export { placeOf };
