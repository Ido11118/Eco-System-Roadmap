// ייצוא ל-PDF: הגאנט מצויר על Canvas (תמיכה מלאה בעברית ו-RTL דרך מנוע הטקסט של הדפדפן),
// עמוד אחרי עמוד, ומוטמע כתמונה ב-PDF לרוחב (A4 / A3).
// טווח ארוך מתפצל לכמה "רצועות" שבועות (כל רצועה — סדרת עמודים); תחומים ארוכים מתפצלים לגובה, והכותרות חוזרות בכל עמוד.
import type { Catalog } from "@/lib/catalog";
import type { ItemDTO, MilestoneDTO, SprintDTO } from "@/lib/types";
import { currentWeekIL, dayOfWeek, weekStartOf, type ISODate } from "@/lib/weeks";
import { weekTag, type ExportModel, type PageSize } from "./model";

const PAGE: Record<PageSize, { w: number; h: number }> = {
  a4: { w: 841.89, h: 595.28 },
  a3: { w: 1190.55, h: 841.89 },
};
const M = 20; // שוליים
const HEADER_H = 50; // כותרת, פרטים ומקרא
const ROW_H = 13; // שורת כותרת זמן (שנה / חודש / שבוע)
const TIME_H = ROW_H * 3;
const FOOTER_H = 16;
const LANE_H = { item: 17, cross: 14, sprint: 13 };
const MIN_WEEK_W = 13;
const MAX_WEEK_W = 48;
const FONT = "Heebo, system-ui, sans-serif";
const C = {
  ink900: "#0f172a", ink700: "#334155", ink500: "#64748b", ink400: "#94a3b8", ink300: "#cbd5e1", ink200: "#e2e8f0", ink100: "#f1f5f9", ink50: "#f8fafc",
  today: "#eff6ff", todayHead: "#dbeafe", violet: "#7c3aed", violetLine: "#a78bfa",
  sprint: ["#ccfbf1", "#99f6e4"], sprintBorder: "#5eead4", sprintText: "#115e59",
};

export type PdfMeta = { title: string; subtitle: string; generatedAt: string; pageSize: PageSize };

type Lane = {
  h: number;
  group: string; groupLabel: string; spanBoth?: boolean;
  sub?: string; subLabel?: string; subKind?: "sprint";
  items?: ItemDTO[]; sprints?: SprintDTO[];
  /** אבני דרך שהמעוין שלהן מצויר בנתיב הזה */
  diamonds?: MilestoneDTO[];
  /** אבני דרך שהקו המקווקו שלהן עובר בנתיב הזה */
  lines?: MilestoneDTO[];
};

function flatten(model: ExportModel): Lane[][] {
  const blocks: Lane[][] = []; // בלוק = יחידה שמשתדלים לא לפצל בין עמודים
  for (const g of model.cross) {
    g.lanes.forEach((items, k) => blocks.push([{
      h: LANE_H.cross, group: `x${g.kind}`, groupLabel: g.label, spanBoth: true, items, diamonds: k === 0 ? g.milestones : [],
    }]));
  }
  for (const d of model.domains) {
    const group = `d${d.domain.id}`;
    const spanBoth = d.merged && !d.sprintLanes.length;
    const sprintLanes: Lane[] = d.sprintLanes.map((sprints) => ({
      h: LANE_H.sprint, group, groupLabel: d.domain.name, sub: `s${d.domain.id}`, subLabel: "ספרינטים", subKind: "sprint", sprints,
    }));
    d.teams.forEach((t, ti) => {
      const lines = [...t.milestones, ...d.milestones];
      const lanes: Lane[] = t.lanes.map((items, k) => ({
        h: LANE_H.item, group, groupLabel: d.domain.name, spanBoth,
        sub: spanBoth ? undefined : `t${t.team.id}`, subLabel: t.team.name, items, lines,
        // אבן דרך של תחום שלם: המעוין פעם אחת — בצוות הראשון; הקו עובר בכל הצוותים (כמו במסך)
        diamonds: k === 0 ? [...t.milestones, ...(ti === 0 ? d.milestones : [])] : [],
      }));
      blocks.push(ti === 0 ? [...sprintLanes, ...lanes] : lanes);
    });
  }
  return blocks;
}

/** חלוקה לעמודים לגובה: בלוק שלא נכנס בעמוד הנוכחי עובר לעמוד הבא; בלוק גבוה מעמוד שלם מתפצל לנתיבים */
function paginate(blocks: Lane[][], cap: number): Lane[][] {
  const pages: Lane[][] = [[]];
  let used = 0;
  const push = (l: Lane) => {
    if (used + l.h > cap && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(l); used += l.h;
  };
  for (const b of blocks) {
    const h = b.reduce((s, l) => s + l.h, 0);
    if (used + h > cap && h <= cap && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    b.forEach(push);
  }
  return pages;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 4) return "";
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo ? text.slice(0, lo) + "…" : "";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

export async function buildPdf(model: ExportModel, cat: Catalog, meta: PdfMeta): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  // הגופן של האפליקציה — טוענים במפורש, אחרת ה-Canvas עלול לצייר בגופן ברירת מחדל
  await Promise.all(["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 10px Heebo`, "אבגabc123").catch(() => [])));

  const page = PAGE[meta.pageSize];
  const domW = meta.pageSize === "a3" ? 84 : 66;
  const teamW = meta.pageSize === "a3" ? 112 : 90;
  const gridRight = page.w - M - domW - teamW;
  const avail = gridRight - M;
  const n = model.timeline.weeks.length;
  const perPage = Math.max(1, Math.floor(avail / MIN_WEEK_W));
  const chunks = Math.max(1, Math.ceil(n / perPage));
  const weeksPer = Math.ceil(n / chunks);
  const weekW = Math.min(MAX_WEEK_W, avail / weeksPer);
  const bodyTop = M + HEADER_H + TIME_H;
  const cap = page.h - bodyTop - M - FOOTER_H;
  const vPages = paginate(flatten(model), cap);
  const total = chunks * vPages.length;

  const scale = 3300 / page.w; // ~3300px רוחב — חד בהדפסה, וגודל קובץ סביר
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(page.w * scale);
  canvas.height = Math.round(page.h * scale);
  const ctx = canvas.getContext("2d")!;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: meta.pageSize, compress: true });
  pdf.setProperties({ title: meta.title, subject: meta.subtitle, creator: "תוכנית עבודה" });

  const cw = currentWeekIL();
  const usedStatuses = [...new Set(model.rows.map((r) => r.item.status))].map((k) => cat.status(k)).sort((a, b) => a.sortOrder - b.sortOrder);
  const crossMs = model.cross.flatMap((g) => g.milestones);
  let pageNo = 0;

  for (let ch = 0; ch < chunks; ch++) {
    const c0 = ch * weeksPer;
    const weeks = model.timeline.weeks.slice(c0, c0 + weeksPer);
    const k = weeks.length;
    const gridLeft = gridRight - k * weekW;
    const xr = (i: number) => gridRight - (i - c0) * weekW; // קצה ימני של שבוע (אינדקס בציר המלא)
    const dateX = (d: ISODate, edge: "start" | "mid" | "end") => {
      const i = model.timeline.indexOf(weekStartOf(d));
      const off = edge === "start" ? 0 : edge === "mid" ? 0.5 : 1;
      return xr(i) - (dayOfWeek(d) + off) * (weekW / 7);
    };
    const visibleX = (x: number) => x <= gridRight + 0.01 && x >= gridLeft - 0.01;

    for (const lanes of vPages) {
      pageNo++;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, page.w, page.h);
      ctx.direction = "rtl";
      ctx.textBaseline = "middle";
      const font = (w: number, size: number) => { ctx.font = `${w} ${size}px ${FONT}`; };
      const text = (s: string, x: number, y: number, align: CanvasTextAlign, color: string, maxW?: number) => {
        ctx.fillStyle = color; ctx.textAlign = align;
        ctx.fillText(maxW !== undefined ? fit(ctx, s, maxW) : s, x, y);
      };
      const line = (x0: number, y0: number, x1: number, y1: number, color: string, w = 0.5, dash: number[] = []) => {
        ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
      };

      // ---------- כותרת העמוד ----------
      const right = page.w - M;
      font(700, 14); text(meta.title, right, M + 8, "right", C.ink900, page.w - 2 * M);
      font(400, 8.5); text(meta.subtitle, right, M + 23, "right", C.ink500, page.w - 2 * M);
      // מקרא
      font(400, 7.5);
      let lx = right;
      const chip = (label: string, draw: (x: number, y: number) => void) => {
        const tw = ctx.measureText(label).width;
        if (lx - tw - 20 < M) return;
        draw(lx, M + 37); // הסמל תופס [lx-8, lx]
        text(label, lx - 11, M + 37, "right", C.ink700);
        lx -= tw + 24;
      };
      for (const s of usedStatuses) chip(s.label, (x, y) => {
        roundRect(ctx, x - 8, y - 4, 8, 8, 1.5); ctx.fillStyle = s.bg; ctx.fill(); ctx.strokeStyle = s.border; ctx.lineWidth = 0.6; ctx.stroke();
      });
      if (model.milestones.length) chip("אבן דרך", (x, y) => drawDiamond(ctx, x - 4, y, 4, false));
      if (model.sprints.length) chip("ספרינט", (x, y) => { roundRect(ctx, x - 8, y - 4, 8, 8, 1.5); ctx.fillStyle = C.sprint[0]; ctx.fill(); ctx.strokeStyle = C.sprintBorder; ctx.stroke(); });

      // ---------- כותרות זמן ----------
      const ty = M + HEADER_H;
      ctx.fillStyle = C.ink50;
      ctx.fillRect(gridLeft, ty, gridRight - gridLeft + domW + teamW, TIME_H);
      const groups = (key: (w: typeof weeks[number]) => string, label: (w: typeof weeks[number]) => string) => {
        const out: { label: string; a: number; b: number }[] = [];
        for (const w of weeks) {
          const last = out[out.length - 1];
          if (last && key(model.timeline.weeks[last.b]) === key(w)) last.b = w.index;
          else out.push({ label: label(w), a: w.index, b: w.index });
        }
        return out;
      };
      const headRow = (y: number, list: { label: string; a: number; b: number }[], size: number, weight: number) => {
        font(weight, size);
        for (const g of list) {
          const x1 = xr(g.a), x0 = xr(g.b) - weekW;
          text(g.label, (x0 + x1) / 2, y + ROW_H / 2, "center", C.ink700, x1 - x0 - 3);
          line(x0, y, x0, y + ROW_H, C.ink200);
        }
        line(gridLeft, y + ROW_H, gridRight, y + ROW_H, C.ink200);
      };
      headRow(ty, groups((w) => String(w.year), (w) => String(w.year)), 8, 700);
      headRow(ty + ROW_H, groups((w) => `${w.year}-${w.month}`, (w) => model.timeline.months.find((m) => m.startIndex <= w.index && w.index < m.startIndex + m.count)?.label ?? ""), 7.5, 600);
      font(400, weekW < 16 ? 6 : 7);
      for (const w of weeks) {
        if (w.start === cw) { ctx.fillStyle = C.todayHead; ctx.fillRect(xr(w.index) - weekW, ty + 2 * ROW_H, weekW, ROW_H); }
        text(String(w.num), xr(w.index) - weekW / 2, ty + 2.5 * ROW_H, "center", C.ink500);
        line(xr(w.index) - weekW, ty + 2 * ROW_H, xr(w.index) - weekW, ty + TIME_H, C.ink200);
      }
      font(600, 8);
      text("תחום", page.w - M - 4, ty + 2.5 * ROW_H, "right", C.ink700);
      text("צוות", page.w - M - domW - 4, ty + 2.5 * ROW_H, "right", C.ink700);
      line(gridRight, ty, gridRight, ty + TIME_H, C.ink300);
      line(gridLeft, ty + TIME_H, page.w - M, ty + TIME_H, C.ink400, 0.8);

      // ---------- גוף ----------
      const bodyH = lanes.reduce((s, l) => s + l.h, 0);
      const bodyBottom = bodyTop + bodyH;
      // רקע: השבוע הנוכחי וקווי שבועות / חודשים
      for (const w of weeks) {
        if (w.start === cw) { ctx.fillStyle = C.today; ctx.fillRect(xr(w.index) - weekW, bodyTop, weekW, bodyH); }
        const monthEnd = model.timeline.weeks[w.index + 1]?.month !== w.month;
        line(xr(w.index) - weekW, bodyTop, xr(w.index) - weekW, bodyBottom, monthEnd ? C.ink200 : C.ink100);
      }
      // אבני דרך רוחביות: קו מנוקד לאורך כל הגוף
      for (const m of crossMs) {
        const x = dateX(m.date, "mid");
        if (visibleX(x)) line(x, bodyTop, x, bodyBottom, C.violetLine, 0.6, [1, 1.5]);
      }

      let y = bodyTop;
      for (let li = 0; li < lanes.length; li++) {
        const l = lanes[li];
        const next = lanes[li + 1];
        // קווים מקווקווים של אבני דרך (צוות / תחום)
        for (const m of l.lines ?? []) {
          const x = dateX(m.date, "mid");
          if (visibleX(x)) line(x, y, x, y + l.h, C.violetLine, 0.6, [2, 1.5]);
        }
        // ספרינטים
        if (l.sprints) {
          font(500, 6.5);
          l.sprints.forEach((s, si) => {
            const x1 = Math.min(gridRight, dateX(s.startDate, "start")), x0 = Math.max(gridLeft, dateX(s.endDate, "end"));
            if (x1 - x0 <= 0.5) return;
            roundRect(ctx, x0 + 0.5, y + 1.5, x1 - x0 - 1, l.h - 3, 2);
            ctx.fillStyle = C.sprint[si % 2]; ctx.fill(); ctx.strokeStyle = C.sprintBorder; ctx.lineWidth = 0.5; ctx.stroke();
            text(s.name, x1 - 2.5, y + l.h / 2, "right", C.sprintText, x1 - x0 - 5);
          });
        }
        // תכולות
        for (const i of l.items ?? []) {
          const a = model.timeline.indexOf(i.startWeek), b = model.timeline.indexOf(i.endWeek);
          if (b < c0 || a >= c0 + k) continue;
          const x1 = xr(Math.max(a, c0)) - 1, x0 = xr(Math.min(b, c0 + k - 1)) - weekW + 1;
          const s = cat.status(i.status);
          roundRect(ctx, x0, y + 2, x1 - x0, l.h - 4, 2.5);
          ctx.fillStyle = s.bg; ctx.fill();
          ctx.strokeStyle = s.border; ctx.lineWidth = 0.6;
          ctx.setLineDash(a < c0 || b >= c0 + k ? [2, 1.5] : []); ctx.stroke(); ctx.setLineDash([]);
          font(500, l.h >= LANE_H.item ? 7.5 : 6.8);
          text(i.name, x1 - 3, y + l.h / 2 + 0.3, "right", s.fg, x1 - x0 - 6);
        }
        // אבני דרך
        for (const m of l.diamonds ?? []) {
          const x = dateX(m.date, "mid");
          if (!visibleX(x)) continue;
          drawDiamond(ctx, x, y + l.h / 2, 3.6, m.domainId !== null && m.teamId === null);
          font(600, 6.3);
          const label = fit(ctx, m.name, 90);
          const tw = ctx.measureText(label).width;
          const tx = Math.max(gridLeft + tw + 2, x - 5);
          ctx.fillStyle = "rgba(255,255,255,.8)";
          ctx.fillRect(tx - tw - 1, y + l.h / 2 - 4, tw + 2, 8);
          text(label, tx, y + l.h / 2 + 0.3, "right", C.violet);
        }
        // קו תחתון: עבה בסוף תחום / קבוצה, דק בסוף צוות
        const endGroup = !next || next.group !== l.group;
        const endSub = endGroup || next.sub !== l.sub;
        line(gridLeft, y + l.h, gridRight + (endSub ? domW + teamW : 0), y + l.h, endGroup ? C.ink400 : endSub ? C.ink200 : C.ink100, endGroup ? 0.9 : 0.5);
        y += l.h;
      }

      // ---------- תוויות תחום / צוות (קבוצות רצופות בעמוד) ----------
      const span = (key: (l: Lane) => string | undefined, draw: (l: Lane, y0: number, h: number) => void) => {
        let y0 = bodyTop;
        for (let i = 0; i < lanes.length;) {
          let j = i, h = 0;
          while (j < lanes.length && key(lanes[j]) === key(lanes[i])) { h += lanes[j].h; j++; }
          if (key(lanes[i]) !== undefined) draw(lanes[i], y0, h);
          y0 += h; i = j;
        }
      };
      const labelX = page.w - M;
      span((l) => l.group, (l, y0, h) => {
        const w = l.spanBoth ? domW + teamW : domW;
        ctx.fillStyle = l.spanBoth && l.group.startsWith("x") ? C.ink50 : "#ffffff";
        ctx.fillRect(labelX - w, y0, w, h);
        font(700, 8);
        wrapText(ctx, l.groupLabel, labelX - 4, y0, w - 8, h, C.ink900);
        line(labelX - w, y0, labelX - w, y0 + h, C.ink200);
      });
      span((l) => (l.spanBoth ? undefined : l.sub), (l, y0, h) => {
        const x = labelX - domW;
        ctx.fillStyle = l.subKind === "sprint" ? "#f0fdfa" : "#ffffff";
        ctx.fillRect(x - teamW, y0, teamW, h);
        font(l.subKind === "sprint" ? 500 : 400, 7.5);
        wrapText(ctx, l.subLabel ?? "", x - 4, y0, teamW - 8, h, l.subKind === "sprint" ? C.sprintText : C.ink700);
        line(x - teamW, y0, x - teamW, y0 + h, C.ink300);
      });
      // מסגרת
      ctx.strokeStyle = C.ink300; ctx.lineWidth = 0.8;
      ctx.strokeRect(gridLeft, ty, page.w - M - gridLeft, bodyBottom - ty);
      if (!lanes.length) { font(400, 10); text("אין נתונים בטווח ובתחומים שנבחרו", (gridLeft + page.w - M) / 2, bodyTop + 30, "center", C.ink500); }

      // ---------- תחתית ----------
      const fy = page.h - M - FOOTER_H / 2 + 4;
      font(400, 7.5);
      text(`הופק ${meta.generatedAt}`, page.w - M, fy, "right", C.ink400);
      text(`עמוד ${pageNo} מתוך ${total}`, M, fy, "left", C.ink400);
      if (chunks > 1) text(`שבועות ${weekTag(weeks[0].start)} – ${weekTag(weeks[k - 1].start)} (חלק ${ch + 1} מתוך ${chunks})`, page.w / 2, fy, "center", C.ink500);

      if (pageNo > 1) pdf.addPage(meta.pageSize, "landscape");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, page.w, page.h, undefined, "FAST");
    }
  }
  return pdf.output("blob");
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hollow: boolean) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  ctx.fillStyle = hollow ? "#ffffff" : C.violet; ctx.fill();
  ctx.strokeStyle = hollow ? C.violet : "#ffffff"; ctx.lineWidth = hollow ? 1.2 : 0.8; ctx.stroke();
}

/** טקסט מיושר לימין, עם גלישה לשורות לפי הגובה הזמין (ומקוצר ב-… אם עדיין ארוך) */
function wrapText(ctx: CanvasRenderingContext2D, s: string, xRight: number, y0: number, maxW: number, h: number, color: string) {
  const size = parseFloat(ctx.font.match(/(\d+(\.\d+)?)px/)?.[1] ?? "8");
  const lh = size * 1.25;
  const maxLines = Math.max(1, Math.floor((h - 2) / lh));
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = lines.slice(maxLines - 1).join(" ");
  ctx.fillStyle = color; ctx.textAlign = "right";
  const top = y0 + h / 2 - ((shown.length - 1) * lh) / 2;
  shown.forEach((t, i) => ctx.fillText(fit(ctx, t, maxW), xRight, top + i * lh));
}
