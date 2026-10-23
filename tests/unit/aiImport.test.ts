import { describe, it, expect } from "vitest";
import { DEFAULT_CATALOG, makeCatalog } from "@/lib/catalog";
import { buildAiPrompt, parseImport, validateEntry, toPayload, placeTeamItems, extractJson, type ImportPerms } from "@/lib/aiImport";
import type { PlanData } from "@/lib/types";

const cat = makeCatalog(DEFAULT_CATALOG);
const data: PlanData = {
  domains: [
    { id: 2, key: "agam", name: 'אג"ם', sortOrder: 2, isSingleTeam: false },
    { id: 4, key: "esh", name: "אש", sortOrder: 4, isSingleTeam: false },
  ],
  teams: [
    { id: 201, key: "azarim-1", name: "עזרים 1", domainId: 2, sortOrder: 1 },
    { id: 401, key: "attack-exposure", name: "חשיפת תקיפה", domainId: 4, sortOrder: 2 },
  ],
  rows: [
    { id: 1, kind: "TEAM", teamId: 201, sortOrder: 1000, version: 1 },
    { id: 2, kind: "TEAM", teamId: 201, sortOrder: 2000, version: 1 },
    { id: 9, kind: "CROSS_EVENT", teamId: null, sortOrder: 0, version: 1 },
  ],
  items: [], milestones: [], sprints: [], users: [],
};
// משתמש עם הרשאה לאג"ם בלבד, בלי רוחבי
const perms: ImportPerms = { canEditTeam: (id) => id === 201, canEditCross: () => false, canEditDomain: (id) => id === 2 };

describe("ai import", () => {
  it("prompt lists only the teams/domains the user may edit, and the catalog values", () => {
    const p = buildAiPrompt(data, perms, cat, "2026-10-16");
    expect(p).toContain('"azarim-1"');
    expect(p).not.toContain('"attack-exposure"');
    expect(p).toContain('"agam"');
    expect(p).not.toContain("INFLUENCE");
    expect(p).toContain('"PLANNED"');
    expect(p).toContain("2026-10-16");
  });

  it("prompt explains the org week numbering with the current week as anchor (no week table)", () => {
    const p = buildAiPrompt(data, perms, cat, "2026-10-16");
    expect(p).toContain("השבוע הנוכחי: שבוע 42 של 2026 (ראשון 2026-10-11 עד שבת 2026-10-17)");
    expect(p).toContain("שבוע 1 של שנה הוא השבוע (ראשון–שבת) שבו חל ה-1 בינואר");
    expect(p).not.toContain("טבלת שבועות");
    expect(p).toContain('"week": 44'); // דוגמת הפלט בשבועות
  });

  it("items accept { week, year } (org numbering) as well as dates; invalid weeks are rejected", () => {
    const es = parseImport(JSON.stringify({ items: [
      { name: "שבועות", team: "azarim-1", start: { week: 52, year: 2026 }, end: { week: 2, year: 2027 } },
      { name: "תאריכים", team: "azarim-1", start: "2026-11-04", end: "2026-11-12" },
      { name: "שבוע 53 לא קיים", team: "azarim-1", start: { week: 53, year: 2026 }, end: { week: 1, year: 2027 } },
    ] }), data, cat);
    expect([es[0].start, es[0].end]).toEqual(["2026-12-20", "2027-01-03"]);
    expect(validateEntry(es[0], data, perms)).toEqual([]);
    expect(toPayload([es[1]]).items[0]).toMatchObject({ startWeek: "2026-11-01", endWeek: "2026-11-08" });
    expect(validateEntry(es[2], data, perms).join()).toContain("שבוע התחלה לא תקין");
  });

  it("extracts JSON from a fenced block with surrounding chat text", () => {
    expect(extractJson('הנה הפלט:\n```json\n{"items":[]}\n```\nבהצלחה')).toEqual({ items: [] });
    expect(() => extractJson("אין כאן כלום")).toThrow();
    expect(() => extractJson('{"items": [')).toThrow();
  });

  it("resolves teams by key or Hebrew name; flags unknown teams and permission problems", () => {
    const es = parseImport(JSON.stringify({
      items: [
        { name: "א", team: "azarim-1", start: "2026-10-20", end: "2026-11-05", status: "בביצוע" },
        { name: "ב", team: "עזרים 1", start: "20/10/2026", end: "2026-10-21", priority: "XYZ" },
        { name: "ג", team: "attack-exposure", start: "2026-10-20", end: "2026-10-21" },
        { name: "ד", team: "לא קיים", start: "2026-10-20", end: "2026-10-21" },
        { name: "ה", team: "CROSS_EVENT", start: "2026-10-20", end: "2026-10-21" },
      ],
      milestones: [{ name: "מ", team: "CROSS", date: "2026-11-01" }],
      sprints: [{ name: "ס", domain: 'אג"ם', start: "2026-11-01", end: "2026-10-01" }],
    }), data, cat);
    const errs = es.map((e) => validateEntry(e, data, perms));
    expect(es[0].teamId).toBe(201);
    expect(es[0].status).toBe("IN_PROGRESS"); // לפי שם התווית
    expect(errs[0]).toEqual([]);
    expect(es[1].teamId).toBe(201);
    expect(es[1].start).toBe("2026-10-20"); // פורמט DD/MM/YYYY
    expect(es[1].warnings.length).toBe(1); // תיעדוף לא מוכר → ברירת מחדל + אזהרה
    expect(errs[1]).toEqual([]);
    expect(errs[2].join()).toContain("אין לך הרשאת עריכה לתחום \"אש\"");
    expect(errs[3].join()).toContain('הצוות "לא קיים" לא קיים במערכת');
    expect(errs[4].join()).toContain("מידע הרוחבי");
    expect(errs[5].join()).toContain("אבני דרך רוחביות");
    expect(errs[6].join()).toContain("תאריך הסיום לפני"); // ספרינט — בתאריכים
  });

  it("milestones: team / whole domain / cross; domain permission enforced", () => {
    const es = parseImport(JSON.stringify({ milestones: [
      { name: "צוות", team: "azarim-1", date: "2026-11-01" },
      { name: "תחום", domain: "agam", date: "2026-11-02" },
      { name: "תחום ללא הרשאה", domain: "אש", date: "2026-11-03" },
      { name: "שניהם", team: "azarim-1", domain: "agam", date: "2026-11-04" },
      { name: "תחום לא קיים", domain: "xyz", date: "2026-11-05" },
    ] }), data, cat);
    const errs = es.map((e) => validateEntry(e, data, perms));
    expect([es[0].teamId, es[0].domainId]).toEqual([201, null]);
    expect([es[1].teamId, es[1].domainId]).toEqual([null, 2]);
    expect(errs[1]).toEqual([]);
    expect(errs[2].join()).toContain('אין לך הרשאת עריכה לתחום "אש"');
    expect(es[3].teamId).toBe(201);
    expect(es[3].warnings.join()).toContain("שויכה לצוות");
    expect(errs[4].join()).toContain('התחום "xyz" לא קיים');
    expect(toPayload([es[1]]).milestones[0]).toMatchObject({ teamId: null, domainId: 2 });
    const p = buildAiPrompt(data, perms, cat, "2026-10-16");
    expect(p).toContain("תחום שלם — כל הצוותים בתחום (domain)");
    expect(p).toContain('"domain": "agam"');
  });

  it("payload snaps item dates to week starts (Sunday)", () => {
    const [e] = parseImport('{"items":[{"name":"x","team":"azarim-1","start":"2026-10-21","end":"2026-10-29"}]}', data, cat);
    expect(toPayload([e]).items[0]).toMatchObject({ teamId: 201, startWeek: "2026-10-18", endWeek: "2026-10-25" });
  });

  it("places items in the first free row, opening a new row only on overlap", () => {
    const existing = [{ rowId: 1, startWeek: "2026-10-18", endWeek: "2026-10-25" }];
    const p = placeTeamItems(data.rows, existing, [
      { teamId: 201, startWeek: "2026-11-01", endWeek: "2026-11-08" }, // פנוי בשורה 1
      { teamId: 201, startWeek: "2026-10-18", endWeek: "2026-10-25" }, // חופף בשורה 1 → שורה 2
      { teamId: 201, startWeek: "2026-10-25", endWeek: "2026-11-01" }, // חופף בשתיהן → שורה חדשה
      { teamId: 201, startWeek: "2026-11-15", endWeek: "2026-11-15" }, // פנוי בשורה 1
    ]);
    expect(p).toEqual([{ rowId: 1 }, { rowId: 2 }, { newRow: 0 }, { rowId: 1 }]);
  });
  it("backlog: prompt explains it; domain required, team optional (team decides the domain); no weeks", () => {
    const p = buildAiPrompt(data, perms, cat, "2026-10-16");
    expect(p).toContain("פריט לבאקלוג (backlog)");
    expect(p).toContain('"backlog"');
    const es = parseImport(JSON.stringify({ backlog: [
      { name: "רעיון", domain: "agam" },
      { name: "עם צוות", team: "azarim-1", domain: "esh", priority: "HIGH" }, // צוות מתחום אחר — התחום של הצוות גובר
      { name: "בלי תחום" },
      { name: "תחום בלי הרשאה", domain: "esh" },
    ] }), data, cat);
    expect(es.map((e) => e.kind)).toEqual(["backlog", "backlog", "backlog", "backlog"]);
    expect(es[0]).toMatchObject({ domainId: 2, teamId: null });
    expect(es[1]).toMatchObject({ domainId: 2, teamId: 201, priority: "HIGH" });
    expect(es[1].warnings.join()).toContain("לא שייך לתחום");
    const errs = es.map((e) => validateEntry(e, data, perms));
    expect(errs[0]).toEqual([]); // בלי שבועות — תקין
    expect(errs[1]).toEqual([]);
    expect(errs[2].join()).toContain("לא צוין תחום");
    expect(errs[3].join()).toContain("אין לך הרשאת עריכה");
    expect(toPayload(es.slice(0, 2)).backlog).toEqual([
      { name: "רעיון", domainId: 2, teamId: null, notes: "" },
      { name: "עם צוות", domainId: 2, teamId: 201, priority: "HIGH", notes: "" },
    ]);
  });
});
