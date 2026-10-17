// ייבוא בעזרת AI: המשתמש מקבל פרומפט מוכן, מנהל שיחה חופשית בכלי AI לבחירתו, ומדביק חזרה JSON.
// לוגיקה טהורה המשמשת גם את הממשק (פענוח, תצוגה מקדימה, בדיקת הרשאות) וגם את השרת (שיבוץ שורות).
import type { PlanData, RowDTO } from "./types";
import type { Catalog } from "./catalog";
import { isISODate, weekStartOf, weekNumber, weekYear, weekEndOf, addWeeks, sundayOfWeekNumber } from "./weeks";

export const AI_IMPORT_FORMAT = "workplan-import/v1";
export const AI_IMPORT_MAX = 300;

export type CrossKind = "INFLUENCE" | "CROSS_EVENT";
export const CROSS_LABEL: Record<CrossKind, string> = { INFLUENCE: "גורמים משפיעים", CROSS_EVENT: "מופעים רוחביים" };
export type ImportKind = "item" | "milestone" | "sprint";

/** רשומה בתצוגה המקדימה — ניתנת לעריכה לפני האישור */
export type ImportEntry = {
  uid: string;
  kind: ImportKind;
  name: string;
  notes: string;
  teamId: number | null; // תכולה/אבן דרך
  cross: CrossKind | null; // תכולה בשורה רוחבית
  domainId: number | null; // ספרינט / אבן דרך של תחום שלם (באבן דרך: teamId ו-domainId שניהם null = רוחבי)
  start: string; // תכולה/ספרינט: התחלה. אבן דרך: התאריך
  end: string;
  status: string; // "" = ברירת מחדל
  priority: string;
  targetError?: string; // ערך שיוך (צוות/תחום) מה-JSON שלא זוהה
  warnings: string[]; // הערות שאינן חוסמות (למשל סטטוס לא מוכר שהוחלף בברירת המחדל)
};

export type ImportPerms = {
  canEditTeam: (teamId: number) => boolean;
  canEditCross: () => boolean;
  canEditDomain: (domainId: number) => boolean;
};

/** המבנה שנשלח לשרת — אחרי בדיקה ונרמול (שבועות = ימי ראשון) */
export type ImportPayload = {
  items: { name: string; teamId: number | null; cross: CrossKind | null; startWeek: string; endWeek: string; status?: string; priority?: string; notes: string }[];
  milestones: { name: string; date: string; teamId: number | null; domainId: number | null; notes: string }[];
  sprints: { name: string; startDate: string; endDate: string; domainId: number; notes: string }[];
};
export type ImportResult = { itemIds: number[]; milestoneIds: number[]; sprintIds: number[]; rowIds: number[] };

// ---------------------------------------------------------------------------
// פרומפט
// ---------------------------------------------------------------------------

export function buildAiPrompt(data: PlanData, perms: ImportPerms, cat: Catalog, today: string): string {
  const domainName = (id: number) => data.domains.find((d) => d.id === id)?.name ?? "";
  const teams = data.teams.filter((t) => perms.canEditTeam(t.id));
  const domains = data.domains.filter((d) => perms.canEditDomain(d.id));
  const cross = perms.canEditCross();
  const exTeam = teams[0]?.key ?? "team-key";
  const exDomain = domains[0]?.key ?? "domain-key";
  const lines: string[] = [];
  const L = (s = "") => lines.push(s);

  L("אתה עוזר תכנון עבודה. המטרה: לעזור לי לבנות רשימה של תכולות עבודה, אבני דרך וספרינטים, ולהפיק בסוף JSON שאדביק במערכת \"תוכנית עבודה\" של הארגון.");
  L();
  L("## איך לעבוד");
  L("- נהל איתי שיחה בעברית. שאל שאלות הבהרה כשחסר מידע (צוות, תאריכים, משך) — אל תמציא פרטים.");
  L("- ייתכן שאעלה קובץ (Excel, מסמך, מצגת) או אדביק טקסט — חלץ ממנו את המידע הרלוונטי והצג לי אותו לאישור.");
  L("- לפני הפלט הסופי הצג טבלת סיכום קצרה (שם, צוות/תחום, תאריכים) ושאל אם לאשר.");
  L("- הפק את ה-JSON רק כשאבקש \"פלט סופי\" או אחרי שאישרתי את הסיכום.");
  L();
  L("## מה אפשר ליצור");
  if (teams.length || cross) L("1. תכולה (items): יחידת עבודה על פני טווח שבועות — פיצ'ר, מודול, פעילות וכו'.");
  if (teams.length || cross) L("2. אבן דרך (milestones): נקודת ציון בתאריך אחד, בלי טווח (למשל: השקה, הצגת תוכנית, מבצע). אבן דרך משויכת לאחד מהבאים: צוות (team), תחום שלם — כל הצוותים בתחום (domain), או כל הארגון (team = \"CROSS\").");
  if (domains.length) L("3. ספרינט (sprints): טווח תאריכים של תחום שלם (למשל: Sprint 12).");
  L();
  if (teams.length) {
    L("## צוותים שאני רשאי לערוך — בשדה team השתמש במזהה (באנגלית) בדיוק כפי שמופיע");
    for (const t of teams) L(`- "${t.key}" — ${t.name} (תחום ${domainName(t.domainId)})`);
  } else L("## אין לי הרשאת עריכה לצוותים — אל תיצור תכולות או אבני דרך של צוות.");
  if (cross) {
    L();
    L("## שורות רוחביות (מותר לי לערוך) — בשדה team של תכולה אפשר גם:");
    L(`- "INFLUENCE" — ${CROSS_LABEL.INFLUENCE}: חגים, אילוצים ארגוניים וגורמים שמשפיעים על התכנון`);
    L(`- "CROSS_EVENT" — ${CROSS_LABEL.CROSS_EVENT}: הצגת תוכניות, דיונים, מפגשים ארגוניים`);
    L("- אבן דרך רוחבית (לכל הארגון): team = \"CROSS\"");
  }
  if (domains.length) {
    L();
    L("## תחומים שאני רשאי לערוך — בשדה domain (של ספרינט, או של אבן דרך לכל התחום) השתמש במזהה");
    for (const d of domains) L(`- "${d.key}" — ${d.name}`);
  }
  L();
  L("## סטטוס (status) — אופציונלי");
  for (const s of cat.statuses) L(`- "${s.key}" — ${s.label}${s.key === cat.defaultStatus ? " (ברירת מחדל)" : ""}`);
  L();
  L("## תיעדוף (priority) — אופציונלי");
  for (const p of cat.priorities) L(`- "${p.key}" — ${p.label}${p.key === cat.defaultPriority ? " (ברירת מחדל)" : ""}`);
  L();
  const cw = weekStartOf(today);
  const exW = addWeeks(cw, 2), exW2 = addWeeks(cw, 4); // דוגמה: שבועיים ממעכשיו, למשך 3 שבועות
  L("## שבועות ותאריכים");
  L(`- היום: ${today}. השבוע הנוכחי: שבוע ${weekNumber(cw)} של ${weekYear(cw)} (ראשון ${cw} עד שבת ${weekEndOf(cw)}).`);
  L("- אנחנו עובדים בשבועות. שבוע = ראשון עד שבת.");
  L("- מספור השבועות שלנו (לא ISO): שבוע 1 של שנה הוא השבוע שמתחיל ביום ראשון הראשון של אותה שנה. ימים שלפניו שייכים לשבוע האחרון של השנה הקודמת.");
  L("- תכולות: התחלה וסיום במספר שבוע + שנה (ראה מבנה הפלט). end הוא השבוע האחרון של העבודה (כולל).");
  L("- אם אזכיר תאריך או חודש (\"מאמצע נובמבר\") — המר למספר שבוע לפי הכלל והשבוע הנוכחי שלמעלה, והצג לי את מספרי השבועות בסיכום.");
  L("- אבני דרך וספרינטים: תאריך מדויק בפורמט YYYY-MM-DD (אבן דרך היא יום מסוים; ספרינט מתחיל ונגמר בימים מסוימים).");
  L();
  L("## הפלט הסופי");
  L("בלוק קוד אחד מסוג json, בלי הערות בתוכו, בדיוק במבנה הבא (רשימה ריקה [] אם אין פריטים מסוג מסוים):");
  L("```json");
  L(JSON.stringify({
    format: AI_IMPORT_FORMAT,
    items: [{ name: "שם התכולה", team: exTeam, start: { week: weekNumber(exW), year: weekYear(exW) }, end: { week: weekNumber(exW2), year: weekYear(exW2) }, status: cat.defaultStatus, priority: cat.defaultPriority, notes: "הערה (אופציונלי)" }],
    milestones: [
      { name: "אבן דרך של צוות", team: exTeam, date: today, notes: "" },
      ...(domains.length ? [{ name: "אבן דרך לכל התחום", domain: exDomain, date: today, notes: "" }] : []),
      ...(cross ? [{ name: "אבן דרך לכל הארגון", team: "CROSS", date: today, notes: "" }] : []),
    ],
    sprints: domains.length ? [{ name: "Sprint 1", domain: exDomain, start: today, end: today, notes: "" }] : [],
  }, null, 2));
  L("```");
  L("כללים:");
  L("- שדות חובה: name, team (או domain בספרינט), ושבועות/תאריכים. באבן דרך: team לצוות, או domain לכל התחום (לא שניהם), או team = \"CROSS\" לכל הארגון. status, priority ו-notes אופציונליים — השמט אותם אם לא ידועים.");
  L("- השתמש רק במזהים מהרשימות למעלה. אם ביקשתי צוות או תחום שאינו ברשימה — אמור לי שאין לי הרשאה במקום לכלול אותו.");
  L("- תכולות של אותו צוות יכולות לחפוף בזמן — המערכת תשבץ אותן בשורות נפרדות.");
  L(`- עד ${AI_IMPORT_MAX} פריטים בסך הכל. שם עד 300 תווים.`);
  L();
  L("התחל בכך שתשאל אותי מה אני רוצה לתכנן.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// פענוח ה-JSON שהודבק
// ---------------------------------------------------------------------------

/** חילוץ JSON מטקסט חופשי: בלוק קוד ```json, או הטקסט שבין { הראשון ל-} האחרון */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a === -1 || b <= a) throw new Error("לא נמצא JSON בטקסט שהודבק. ודא שהעתקת את הפלט הסופי מהשיחה (בלוק הקוד).");
  try { return JSON.parse(t.slice(a, b + 1)); }
  catch { throw new Error("ה-JSON שהודבק אינו תקין (ייתכן שהועתק חלקית). בקש מכלי ה-AI להפיק את הפלט הסופי מחדש."); }
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[״”“'׳"]/g, '"').replace(/\s+/g, " ");

function parseDate(v: unknown): string {
  const s = String(v ?? "").trim();
  const iso0: string = s;
  if (isISODate(iso0)) return iso0;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // 16/10/2026
  if (m) { const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; if (isISODate(iso)) return iso; }
  return "";
}

/** התחלה/סיום של תכולה: { week, year } לפי מספור הארגון (מומר ליום ראשון של השבוע), או תאריך רגיל */
function parseWeekOrDate(v: unknown): string {
  if (v && typeof v === "object") {
    const o = v as { week?: unknown; year?: unknown };
    const week = Number(o.week), year = Number(o.year);
    if (!Number.isInteger(week) || !Number.isInteger(year) || week < 1 || week > 53 || year < 2000 || year > 2100) return "";
    const sunday = sundayOfWeekNumber(year, week);
    return weekYear(sunday) === year ? sunday : ""; // שבוע 53 שאינו קיים באותה שנה
  }
  return parseDate(v);
}

let uidSeq = 0;
const newUid = () => `e${++uidSeq}`;

export function parseImport(text: string, data: PlanData, cat: Catalog): ImportEntry[] {
  const j = extractJson(text);
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("מבנה ה-JSON אינו תקין: מצופה אובייקט עם items / milestones / sprints.");
  const obj = j as Record<string, unknown>;
  const list = (k: string) => {
    const v = obj[k];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new Error(`השדה "${k}" חייב להיות רשימה.`);
    return v.map((x) => (x && typeof x === "object" ? x : {}) as Record<string, unknown>);
  };
  const items = list("items"), mss = list("milestones"), sps = list("sprints");
  const total = items.length + mss.length + sps.length;
  if (!total) throw new Error("ה-JSON לא מכיל תכולות, אבני דרך או ספרינטים.");
  if (total > AI_IMPORT_MAX) throw new Error(`ניתן לייבא עד ${AI_IMPORT_MAX} פריטים בפעם אחת (התקבלו ${total}).`);

  const findTeam = (v: unknown) => {
    const n = norm(v);
    const hits = data.teams.filter((t) => norm(t.key) === n || norm(t.name) === n);
    return hits.length === 1 ? hits[0] : undefined;
  };
  const findDomain = (v: unknown) => { const x = norm(v); return data.domains.find((d) => norm(d.key) === x || norm(d.name) === x); };
  const crossOf = (v: unknown): CrossKind | null => {
    const x = norm(v);
    if (["influence", norm(CROSS_LABEL.INFLUENCE)].includes(x)) return "INFLUENCE";
    if (["cross_event", "cross-event", norm(CROSS_LABEL.CROSS_EVENT)].includes(x)) return "CROSS_EVENT";
    return null;
  };
  const pick = (v: unknown, kind: "status" | "priority", warnings: string[]) => {
    if (v === undefined || v === null || String(v).trim() === "") return "";
    const opts = kind === "status" ? cat.statuses : cat.priorities;
    const hit = opts.find((o) => norm(o.key) === norm(v) || norm(o.label) === norm(v));
    if (!hit) warnings.push(`${kind === "status" ? "סטטוס" : "תיעדוף"} "${String(v)}" לא קיים — השדה נשאר ריק (בייבוא תיקבע ברירת המחדל)`);
    return hit?.key ?? "";
  };
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const base = (kind: ImportKind, r: Record<string, unknown>): ImportEntry => ({
    uid: newUid(), kind, name: str(r.name).trim(), notes: str(r.notes), teamId: null, cross: null, domainId: null,
    start: "", end: "", status: "", priority: "", warnings: [],
  });

  const out: ImportEntry[] = [];
  for (const r of items) {
    const e = base("item", r);
    const cross = crossOf(r.team);
    const team = cross ? undefined : findTeam(r.team);
    if (cross) e.cross = cross; else if (team) e.teamId = team.id;
    else e.targetError = r.team ? `הצוות "${str(r.team)}" לא קיים במערכת` : "לא צוין צוות";
    e.start = parseWeekOrDate(r.start); e.end = parseWeekOrDate(r.end ?? r.start);
    e.status = pick(r.status, "status", e.warnings);
    e.priority = pick(r.priority, "priority", e.warnings);
    out.push(e);
  }
  for (const r of mss) {
    const e = base("milestone", r);
    const x = norm(r.team);
    if (x && !["cross", "רוחבי", "null"].includes(x)) {
      const team = findTeam(r.team);
      if (team) e.teamId = team.id; else e.targetError = `הצוות "${str(r.team)}" לא קיים במערכת`;
      if (r.domain) e.warnings.push("צוינו גם צוות וגם תחום — אבן הדרך שויכה לצוות");
    } else if (r.domain && !x) {
      const d = findDomain(r.domain); // אבן דרך לכל התחום
      if (d) e.domainId = d.id; else e.targetError = `התחום "${str(r.domain)}" לא קיים במערכת`;
    } // אחרת: רוחבי (כל הארגון)
    e.start = parseDate(r.date ?? r.start);
    out.push(e);
  }
  for (const r of sps) {
    const e = base("sprint", r);
    const d = findDomain(r.domain);
    if (d) e.domainId = d.id; else e.targetError = r.domain ? `התחום "${str(r.domain)}" לא קיים במערכת` : "לא צוין תחום";
    e.start = parseDate(r.start); e.end = parseDate(r.end);
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// בדיקת רשומה (הרשאות ותקינות) — רשומה עם שגיאות לא תיובא
// ---------------------------------------------------------------------------

export function validateEntry(e: ImportEntry, data: PlanData, perms: ImportPerms): string[] {
  const errs: string[] = [];
  const domainOfTeam = (id: number) => data.domains.find((d) => d.id === data.teams.find((t) => t.id === id)?.domainId);
  if (!e.name.trim()) errs.push("חסר שם");
  else if (e.name.trim().length > 300) errs.push("השם ארוך מדי (עד 300 תווים)");
  if (e.notes.length > 5000) errs.push("ההערה ארוכה מדי");
  const okYear = (s: string) => +s.slice(0, 4) >= 2000 && +s.slice(0, 4) <= 2100;

  if (e.kind === "sprint") {
    if (e.domainId === null) errs.push(e.targetError ?? "לא נבחר תחום");
    else if (!perms.canEditDomain(e.domainId)) errs.push(`אין לך הרשאת עריכה לתחום "${data.domains.find((d) => d.id === e.domainId)?.name ?? ""}"`);
  } else if (e.kind === "milestone" && e.teamId === null && e.domainId !== null) {
    if (!perms.canEditDomain(e.domainId)) errs.push(`אין לך הרשאת עריכה לתחום "${data.domains.find((d) => d.id === e.domainId)?.name ?? ""}"`);
  } else if (e.kind === "item" && e.cross) {
    if (!perms.canEditCross()) errs.push(`אין לך הרשאת עריכה למידע הרוחבי (${CROSS_LABEL[e.cross]})`);
  } else if (e.teamId === null) {
    if (e.kind === "item") errs.push(e.targetError ?? "לא נבחר צוות");
    else if (e.targetError) errs.push(e.targetError);
    else if (!perms.canEditCross()) errs.push("אין לך הרשאת עריכה לאבני דרך רוחביות");
  } else if (!data.teams.some((t) => t.id === e.teamId)) errs.push("הצוות לא קיים");
  else if (!perms.canEditTeam(e.teamId)) errs.push(`אין לך הרשאת עריכה לתחום "${domainOfTeam(e.teamId)?.name ?? ""}"`);

  const what = e.kind === "item" ? "שבוע" : "תאריך"; // תכולות — בשבועות; אבני דרך וספרינטים — בתאריכים
  if (!isISODate(e.start) || !okYear(e.start)) errs.push(e.kind === "milestone" ? "תאריך לא תקין" : `${what} התחלה לא תקין`);
  if (e.kind !== "milestone") {
    if (!isISODate(e.end) || !okYear(e.end)) errs.push(`${what} סיום לא תקין`);
    else if (isISODate(e.start)) {
      const bad = e.kind === "item" ? weekStartOf(e.end) < weekStartOf(e.start) : e.end < e.start;
      if (bad) errs.push(e.kind === "item" ? "שבוע הסיום לפני שבוע ההתחלה" : "תאריך הסיום לפני תאריך ההתחלה");
    }
  }
  return errs;
}

export function toPayload(entries: ImportEntry[]): ImportPayload {
  const p: ImportPayload = { items: [], milestones: [], sprints: [] };
  for (const e of entries) {
    const name = e.name.trim();
    if (e.kind === "item") p.items.push({
      name, teamId: e.cross ? null : e.teamId, cross: e.cross, startWeek: weekStartOf(e.start), endWeek: weekStartOf(e.end),
      ...(e.status ? { status: e.status } : {}), ...(e.priority ? { priority: e.priority } : {}), notes: e.notes,
    });
    else if (e.kind === "milestone") p.milestones.push({ name, date: e.start, teamId: e.teamId, domainId: e.teamId !== null ? null : e.domainId, notes: e.notes });
    else p.sprints.push({ name, startDate: e.start, endDate: e.end, domainId: e.domainId!, notes: e.notes });
  }
  return p;
}

// ---------------------------------------------------------------------------
// שיבוץ תכולות צוות בשורות: השורה הראשונה (לפי הסדר) שאין בה חפיפה; אחרת שורה חדשה בסוף הצוות
// ---------------------------------------------------------------------------

export type Placement = { rowId: number } | { newRow: number }; // newRow = אינדקס השורה החדשה בתוך הצוות

export function placeTeamItems(
  rows: Pick<RowDTO, "id" | "kind" | "teamId" | "sortOrder">[],
  items: { rowId: number; startWeek: string; endWeek: string }[],
  list: { teamId: number; startWeek: string; endWeek: string }[],
): Placement[] {
  const occ = new Map<string, { s: string; e: string }[]>();
  const add = (k: string, s: string, e: string) => { const a = occ.get(k) ?? []; a.push({ s, e }); occ.set(k, a); };
  for (const it of items) add(`r${it.rowId}`, it.startWeek, it.endWeek);
  const newCount = new Map<number, number>();
  return list.map((x) => {
    const teamRows = rows.filter((r) => r.kind === "TEAM" && r.teamId === x.teamId).sort((a, b) => a.sortOrder - b.sortOrder);
    const keys = [...teamRows.map((r) => `r${r.id}`), ...Array.from({ length: newCount.get(x.teamId) ?? 0 }, (_, k) => `n${x.teamId}:${k}`)];
    let key = keys.find((k) => !(occ.get(k) ?? []).some((o) => o.s <= x.endWeek && o.e >= x.startWeek));
    if (!key) { const k = newCount.get(x.teamId) ?? 0; newCount.set(x.teamId, k + 1); key = `n${x.teamId}:${k}`; }
    add(key, x.startWeek, x.endWeek);
    return key.startsWith("r") ? { rowId: Number(key.slice(1)) } : { newRow: Number(key.split(":")[1]) };
  });
}
