// ייצוא ל-Excel: גיליון "תכולות" (טבלת נתונים עם סינון), גיליון "גאנט" (תאים צבועים לפי שבוע),
// ולפי בחירה — גיליונות "אבני דרך" ו"ספרינטים". כל הגיליונות מימין לשמאל.
import type { Workbook, Worksheet, Cell, Borders } from "exceljs";
import type { Catalog } from "@/lib/catalog";
import type { ItemDTO, MilestoneDTO, PlanData, SprintDTO } from "@/lib/types";
import { depsOf } from "@/lib/deps";
import { msScopeLabel } from "@/lib/milestone";
import { fmtDate, parseISO, weekEndOf, weekStartOf, weeksDiff, type ISODate } from "@/lib/weeks";
import { weekTag, type ExportModel } from "./model";

const argb = (hex: string) => "FF" + (hex.replace("#", "").length === 6 ? hex.replace("#", "") : "E2E8F0").toUpperCase();
const fill = (hex: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: argb(hex) } });
const thin = (hex: string) => ({ style: "thin" as const, color: { argb: argb(hex) } });
const GRID = "#E2E8F0", HEAD = "#F1F5F9", DARK = "#94A3B8";
const SPRINT = { bg: "#CCFBF1", fg: "#115E59", border: "#5EEAD4" };
const MS_COLOR = "#6D28D9";
const xlDate = (s: ISODate) => parseISO(s); // תאריך "טהור" ב-UTC — Excel מציג אותו כמו שהוא

export type ExcelMeta = { title: string; subtitle: string; generatedAt: string };

export async function buildWorkbook(model: ExportModel, data: PlanData, cat: Catalog, meta: ExcelMeta): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "תוכנית עבודה";
  wb.created = new Date();
  itemsSheet(wb, model, cat, meta);
  ganttSheet(wb, model, data, cat, meta);
  if (model.milestones.length) milestonesSheet(wb, model.milestones, data);
  if (model.sprints.length) sprintsSheet(wb, model.sprints, data);
  return wb;
}

export async function workbookBlob(wb: Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function newSheet(wb: Workbook, name: string, frozen: { x: number; y: number }) {
  return wb.addWorksheet(name, {
    views: [{ rightToLeft: true, state: "frozen", xSplit: frozen.x, ySplit: frozen.y, showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  });
}

/** כותרת הגיליון: שורת כותרת ושורת פרטים (טווח, תחומים, מסננים) */
function titleRows(ws: Worksheet, meta: ExcelMeta, width: number) {
  ws.getCell(1, 1).value = meta.title;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: argb("#0F172A") } };
  ws.getCell(2, 1).value = `${meta.subtitle} · הופק ${meta.generatedAt}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: argb("#64748B") } };
  if (width > 1) { ws.mergeCells(1, 1, 1, width); ws.mergeCells(2, 1, 2, width); }
}

function headerRow(ws: Worksheet, rowNo: number, labels: string[]) {
  const r = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l;
    c.font = { bold: true, color: { argb: argb("#334155") } };
    c.fill = fill(HEAD);
    c.border = { bottom: thin(DARK) };
    c.alignment = { vertical: "middle", horizontal: "right" };
  });
  r.height = 22;
}

// ---------------------------------------------------------------------------
// גיליון 1: טבלת תכולות
// ---------------------------------------------------------------------------
function itemsSheet(wb: Workbook, model: ExportModel, cat: Catalog, meta: ExcelMeta) {
  const cols: { h: string; w: number }[] = [
    { h: "ID", w: 8 }, { h: "תחום", w: 16 }, { h: "צוות", w: 18 }, { h: "שם התכולה", w: 42 }, { h: "סטטוס", w: 14 }, { h: "תיעדוף", w: 11 },
    { h: "שבוע התחלה", w: 12 }, { h: "תאריך התחלה", w: 13 }, { h: "שבוע סיום", w: 11 }, { h: "תאריך סיום", w: 13 },
    { h: "משך (שבועות)", w: 12 }, { h: "תלויות", w: 40 }, { h: "הערות", w: 50 },
  ];
  const ws = newSheet(wb, "תכולות", { x: 0, y: 4 });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
  titleRows(ws, meta, cols.length);
  headerRow(ws, 4, cols.map((c) => c.h));
  model.rows.forEach(({ item: i, domain, team }, k) => {
    const s = cat.status(i.status);
    const deps = depsOf(i).map((d) => `${d.done ? "✓" : "•"} ${d.text}${d.on ? ` (מול ${d.on})` : ""}`).join("\n");
    const r = ws.getRow(5 + k);
    r.values = [
      i.id, domain, team, i.name, s.label, cat.priority(i.priority).label,
      weekTag(i.startWeek), xlDate(i.startWeek), weekTag(i.endWeek), xlDate(weekEndOf(i.endWeek)),
      weeksDiff(i.startWeek, i.endWeek) + 1, deps, i.notes,
    ];
    r.getCell(8).numFmt = "dd/mm/yyyy";
    r.getCell(10).numFmt = "dd/mm/yyyy";
    const sc = r.getCell(5);
    sc.fill = fill(s.bg); sc.font = { color: { argb: argb(s.fg) } }; sc.border = { top: thin(s.border), bottom: thin(s.border), left: thin(s.border), right: thin(s.border) };
    r.eachCell({ includeEmpty: true }, (c, n) => {
      c.alignment = { vertical: "top", horizontal: n === 1 || n === 7 || n === 9 || n === 11 ? "center" : "right", wrapText: n === 4 || n >= 12 };
      if (n !== 5) c.border = { bottom: thin(GRID) };
    });
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + Math.max(1, model.rows.length), column: cols.length } };
  if (!model.rows.length) ws.getCell(5, 1).value = "אין תכולות בטווח ובסינון שנבחרו";
}

// ---------------------------------------------------------------------------
// גיליון 2: גאנט
// ---------------------------------------------------------------------------
function ganttSheet(wb: Workbook, model: ExportModel, data: PlanData, cat: Catalog, meta: ExcelMeta) {
  const { timeline } = model;
  const W0 = 3; // עמודה ראשונה של השבועות (1 = תחום, 2 = צוות)
  const H = 6; // שורת הכותרת האחרונה (שנה / חודש / שבוע בשורות 4–6)
  const nW = timeline.weeks.length;
  const ws = newSheet(wb, "גאנט", { x: W0 - 1, y: H });
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 18;
  for (let i = 0; i < nW; i++) ws.getColumn(W0 + i).width = 4.2;
  titleRows(ws, meta, Math.min(W0 + nW - 1, 40));

  // כותרות זמן: שנה, חודש, מספר שבוע
  const head = (r: number, c: number, v: string | number) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.fill = fill(HEAD);
    cell.font = { bold: r < H, size: r === H ? 8 : 10, color: { argb: argb("#334155") } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: thin(GRID), left: thin(GRID) };
  };
  for (const g of timeline.years) { head(4, W0 + g.startIndex, g.label); if (g.count > 1) ws.mergeCells(4, W0 + g.startIndex, 4, W0 + g.startIndex + g.count - 1); }
  for (const g of timeline.months) { head(5, W0 + g.startIndex, g.label); if (g.count > 1) ws.mergeCells(5, W0 + g.startIndex, 5, W0 + g.startIndex + g.count - 1); }
  timeline.weeks.forEach((w) => {
    head(H, W0 + w.index, w.num);
    ws.getCell(H, W0 + w.index).note = `שבוע ${w.num} · ${fmtDate(w.start)}–${fmtDate(w.end)}`;
  });
  for (const c of [1, 2]) { head(4, c, ""); head(5, c, ""); }
  head(H, 1, "תחום"); head(H, 2, "צוות");
  ws.mergeCells(4, 1, 5, 2);
  ws.getRow(H).height = 16;

  let r = H + 1;
  const clip = (a: ISODate, b: ISODate) => {
    const i0 = timeline.indexOf(weekStartOf(a)), i1 = timeline.indexOf(weekStartOf(b));
    if (i1 < 0 || i0 >= nW) return null;
    return [Math.max(0, i0), Math.min(nW - 1, i1)] as const;
  };
  const gridRow = (row: number) => {
    for (let i = 0; i < nW; i++) {
      const c = ws.getCell(row, W0 + i);
      c.border = { left: thin(timeline.weeks[i + 1]?.month !== timeline.weeks[i].month ? "#CBD5E1" : "#F1F5F9"), bottom: thin("#F1F5F9") };
    }
    ws.getRow(row).height = 18;
  };
  const bar = (row: number, a: number, b: number, text: string, c: { bg: string; fg: string; border: string }, note?: string) => {
    const cell = ws.getCell(row, W0 + a);
    cell.value = text;
    const style = (x: Cell) => {
      x.fill = fill(c.bg);
      x.border = { top: thin(c.border), bottom: thin(c.border), left: thin(c.border), right: thin(c.border) };
    };
    for (let i = a; i <= b; i++) style(ws.getCell(row, W0 + i));
    cell.font = { size: 9, color: { argb: argb(c.fg) } };
    cell.alignment = { vertical: "middle", horizontal: "right", shrinkToFit: false };
    if (note) cell.note = note;
    if (b > a) ws.mergeCells(row, W0 + a, row, W0 + b);
  };
  const itemBar = (row: number, i: ItemDTO) => {
    const w = clip(i.startWeek, i.endWeek);
    if (!w) return;
    const s = cat.status(i.status);
    bar(row, w[0], w[1], i.name, s,
      `${i.name}\nID ${i.id} · ${s.label}\nשבועות ${weekTag(i.startWeek)}–${weekTag(i.endWeek)} (${fmtDate(i.startWeek)}–${fmtDate(weekEndOf(i.endWeek))})${i.notes ? `\n${i.notes}` : ""}`);
  };
  /** אבני דרך בשורה אחת: "◆ שם" בשבוע של כל אחת (כמה באותו שבוע — מחוברות) */
  const milestoneRow = (row: number, list: MilestoneDTO[]) => {
    const byWeek = new Map<number, MilestoneDTO[]>();
    for (const m of list) {
      const w = timeline.indexOf(weekStartOf(m.date));
      if (w < 0 || w >= nW) continue;
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w)!.push(m);
    }
    for (const [w, arr] of byWeek) {
      const c = ws.getCell(row, W0 + w);
      c.value = arr.map((m) => `◆ ${m.name}`).join("; ");
      c.font = { size: 9, bold: true, color: { argb: argb(MS_COLOR) } };
      c.alignment = { vertical: "middle", horizontal: "right" };
      c.note = arr.map((m) => `◆ ${m.name}\n${fmtDate(m.date)} · ${msScopeLabel(m, data)}${m.notes ? `\n${m.notes}` : ""}`).join("\n\n");
    }
  };
  const label = (r0: number, r1: number, c0: number, c1: number, text: string, opts?: { bold?: boolean; bg?: string; color?: string; italic?: boolean }) => {
    const c = ws.getCell(r0, c0);
    c.value = text;
    c.font = { bold: opts?.bold, italic: opts?.italic, size: 10, color: { argb: argb(opts?.color ?? "#0F172A") } };
    c.alignment = { vertical: "middle", horizontal: "right", wrapText: true };
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
      const x = ws.getCell(rr, cc);
      x.fill = fill(opts?.bg ?? "#FFFFFF");
      x.border = { left: thin(GRID), bottom: thin(GRID) };
    }
    if (r1 > r0 || c1 > c0) ws.mergeCells(r0, c0, r1, c1);
  };
  /** קו מפריד בתחתית בלוק (תחום / קבוצה רוחבית) */
  const blockEnd = (row: number) => {
    for (let c = 1; c < W0 + nW; c++) {
      const x = ws.getCell(row, c);
      x.border = { ...(x.border as Partial<Borders>), bottom: { style: "medium", color: { argb: argb(DARK) } } };
    }
  };

  // שורות רוחביות
  for (const g of model.cross) {
    const start = r;
    for (const lane of g.lanes) { gridRow(r); for (const i of lane) itemBar(r, i); r++; }
    if (g.milestones.length) { gridRow(r); milestoneRow(r, g.milestones); r++; }
    label(start, r - 1, 1, 2, g.label, { bold: true, bg: "#F8FAFC" });
    blockEnd(r - 1);
  }

  // תחומים → צוותים
  for (const d of model.domains) {
    const start = r;
    for (const lane of d.sprintLanes) {
      gridRow(r);
      label(r, r, 2, 2, "ספרינטים", { italic: true, color: SPRINT.fg, bg: "#F0FDFA" });
      for (const s of lane) {
        const w = clip(s.startDate, s.endDate);
        if (w) bar(r, w[0], w[1], s.name, SPRINT, `${s.name}\n${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}${s.notes ? `\n${s.notes}` : ""}`);
      }
      r++;
    }
    // אבני דרך: של התחום כולו ושל צוותיו — בשורה אחת בראש התחום, עם שם הצוות
    const ms = [...d.milestones, ...d.teams.flatMap((t) => t.milestones)].sort((a, b) => a.date.localeCompare(b.date));
    if (ms.length) {
      gridRow(r);
      label(r, r, 2, 2, "אבני דרך", { italic: true, color: MS_COLOR, bg: "#F5F3FF" });
      milestoneRow(r, ms.map((m) => (m.teamId !== null && !d.merged ? { ...m, name: `${m.name} (${d.teams.find((t) => t.team.id === m.teamId)?.team.name ?? ""})` } : m)));
      r++;
    }
    for (const t of d.teams) {
      const ts = r;
      for (const lane of t.lanes) { gridRow(r); for (const i of lane) itemBar(r, i); r++; }
      label(ts, r - 1, 2, 2, t.team.name);
    }
    label(start, r - 1, 1, 1, d.domain.name, { bold: true });
    blockEnd(r - 1);
  }
  if (r === H + 1) ws.getCell(r, 1).value = "אין נתונים בטווח ובתחומים שנבחרו";

  // מקרא סטטוסים בתחתית
  r += 1;
  ws.getCell(r, 1).value = "מקרא:";
  ws.getCell(r, 1).font = { bold: true, size: 9 };
  let c = W0;
  for (const s of cat.statuses) {
    const x = ws.getCell(r, c);
    x.value = s.label; x.fill = fill(s.bg); x.font = { size: 9, color: { argb: argb(s.fg) } };
    x.alignment = { horizontal: "center" };
    x.border = { top: thin(s.border), bottom: thin(s.border), left: thin(s.border), right: thin(s.border) };
    ws.mergeCells(r, c, r, c + 2);
    c += 4;
  }
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 8 as never /* A3 — חסר בהגדרות הטיפוסים של exceljs */ };
}

// ---------------------------------------------------------------------------
// גיליונות אבני דרך / ספרינטים
// ---------------------------------------------------------------------------
function milestonesSheet(wb: Workbook, list: MilestoneDTO[], data: PlanData) {
  const ws = newSheet(wb, "אבני דרך", { x: 0, y: 1 });
  [36, 13, 10, 28, 50].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  headerRow(ws, 1, ["שם", "תאריך", "שבוע", "שיוך", "הערות"]);
  list.forEach((m, k) => {
    const r = ws.getRow(2 + k);
    r.values = [m.name, xlDate(m.date), weekTag(weekStartOf(m.date)), msScopeLabel(m, data), m.notes];
    r.getCell(2).numFmt = "dd/mm/yyyy";
    r.eachCell({ includeEmpty: true }, (c) => { c.alignment = { vertical: "top", horizontal: "right", wrapText: true }; c.border = { bottom: thin(GRID) }; });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + list.length, column: 5 } };
}

function sprintsSheet(wb: Workbook, list: SprintDTO[], data: PlanData) {
  const ws = newSheet(wb, "ספרינטים", { x: 0, y: 1 });
  [30, 18, 13, 13, 50].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  headerRow(ws, 1, ["שם", "תחום", "מתאריך", "עד תאריך", "הערות"]);
  list.forEach((s, k) => {
    const r = ws.getRow(2 + k);
    r.values = [s.name, data.domains.find((d) => d.id === s.domainId)?.name ?? "", xlDate(s.startDate), xlDate(s.endDate), s.notes];
    r.getCell(3).numFmt = "dd/mm/yyyy";
    r.getCell(4).numFmt = "dd/mm/yyyy";
    r.eachCell({ includeEmpty: true }, (c) => { c.alignment = { vertical: "top", horizontal: "right", wrapText: true }; c.border = { bottom: thin(GRID) }; });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + list.length, column: 5 } };
}
