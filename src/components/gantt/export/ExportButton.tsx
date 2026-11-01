"use client";
// כפתור "ייצוא" בגאנט: בחירת פורמט (Excel / PDF) → חלון הגדרות (טווח שבועות, תחומים, אבני דרך וספרינטים) → הורדה.
import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import type { PlanData, ViewConfig } from "@/lib/types";
import { CROSS_ROW_LABELS } from "@/lib/constants";
import { useCatalog } from "@/components/CatalogProvider";
import { Dialog } from "@/components/ui/dialog";
import { Floating, MenuItem } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { WeekPicker } from "@/components/plan/WeekPicker";
import { CROSS_FILTER, timeLabel, timeWindow } from "@/components/plan/filters";
import { fmtDate, todayIL, weekStartOf, type ISODate } from "@/lib/weeks";
import { buildExportModel, defaultDomainIds, exportFileName, fullRange, weekTag, type ExportFormat, type ExportOptions, type PageSize } from "./model";

const FORMAT_LABEL: Record<ExportFormat, string> = { xlsx: "Excel", pdf: "PDF" };

export function ExportButton({ data, view, sourceName }: { data: PlanData; view: ViewConfig; sourceName?: string }) {
  const [menu, setMenu] = useState(false);
  const [format, setFormat] = useState<ExportFormat | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const choose = (f: ExportFormat) => { setMenu(false); setFormat(f); };
  return (
    <>
      <button ref={btn} className="btn-secondary" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-haspopup="menu"
        data-testid="export-gantt" title="ייצוא הגאנט ל-Excel או ל-PDF">
        <Download size={14} /><span className="hidden md:inline">ייצוא</span>
      </button>
      <Floating anchor={btn.current} open={menu} onClose={() => setMenu(false)} className="w-48 p-1">
        <div role="menu" data-testid="export-menu">
          <MenuItem icon={<FileSpreadsheet size={14} className="text-emerald-600" />} onClick={() => choose("xlsx")}>Excel</MenuItem>
          <MenuItem icon={<FileText size={14} className="text-red-600" />} onClick={() => choose("pdf")}>PDF</MenuItem>
        </div>
      </Floating>
      {format && <ExportDialog key={format} format={format} data={data} view={view} sourceName={sourceName} onClose={() => setFormat(null)} />}
    </>
  );
}

function ExportDialog({ format, data, view, sourceName, onClose }: {
  format: ExportFormat; data: PlanData; view: ViewConfig; sourceName?: string; onClose: () => void;
}) {
  const cat = useCatalog();
  const toast = useToast();
  const [full0, full1] = useMemo(() => fullRange(data), [data]);
  const [from, setFrom] = useState<ISODate>(full0);
  const [to, setTo] = useState<ISODate>(full1);
  const [domainIds, setDomainIds] = useState<number[]>(() => defaultDomainIds(data, view));
  const [milestones, setMilestones] = useState(false);
  const [sprints, setSprints] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>("a3");
  const [busy, setBusy] = useState(false);

  const viewRange = useMemo(() => {
    const [a, b] = timeWindow(view.time, data);
    return [weekStartOf(a), weekStartOf(b)] as const;
  }, [view.time, data]);
  const isFull = from === full0 && to === full1;
  const isView = from === viewRange[0] && to === viewRange[1];

  const opts: ExportOptions = { from, to, domainIds, milestones, sprints };
  const model = useMemo(() => buildExportModel(data, view, opts), [data, view, from, to, domainIds, milestones, sprints]); // eslint-disable-line react-hooks/exhaustive-deps

  const domainOpts = [
    { id: CROSS_FILTER.INFLUENCE, label: CROSS_ROW_LABELS.INFLUENCE },
    { id: CROSS_FILTER.CROSS_EVENT, label: CROSS_ROW_LABELS.CROSS_EVENT },
    ...[...data.domains].sort((a, b) => a.sortOrder - b.sortOrder).map((d) => ({ id: d.id, label: d.name })),
  ];
  const toggle = (id: number) => setDomainIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  // מסננים פעילים נוספים (חלים גם על הייצוא) — מוצגים למשתמש כדי שלא יופתע
  const active: string[] = [];
  if (view.teamIds.length) active.push(`צוותים (${view.teamIds.length})`);
  if (view.statuses.length) active.push(`סטטוס: ${view.statuses.map((s) => cat.status(s).label).join(", ")}`);
  if (view.priorities.length) active.push(`תיעדוף: ${view.priorities.map((p) => cat.priority(p).label).join(", ")}`);
  if (view.search.trim()) active.push(`חיפוש: "${view.search.trim()}"`);

  const error = !domainIds.length ? "יש לבחור לפחות תחום אחד" : from > to ? "שבוע הסיום מוקדם משבוע ההתחלה" : null;

  const run = async () => {
    if (error) return;
    setBusy(true);
    try {
      const today = todayIL();
      const now = new Date();
      const generatedAt = `${fmtDate(today)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const names = domainOpts.filter((o) => domainIds.includes(o.id)).map((o) => o.label);
      const scope = names.length === domainOpts.length ? "כל התחומים" : names.join(", ");
      const title = `תוכנית עבודה — גאנט${sourceName ? ` · ${sourceName}` : ""}`;
      const subtitle = [`שבועות ${weekTag(from)} – ${weekTag(to)}`, scope, ...active].join(" · ");
      const name = exportFileName(format, today, sourceName);
      let blob: Blob;
      if (format === "xlsx") {
        const { buildWorkbook, workbookBlob } = await import("./excel");
        blob = await workbookBlob(await buildWorkbook(model, data, cat, { title, subtitle, generatedAt }));
      } else {
        const { buildPdf } = await import("./pdf");
        blob = await buildPdf(model, cat, { title, subtitle, generatedAt, pageSize });
      }
      download(blob, name);
      toast.show("success", `הקובץ "${name}" הורד`);
      onClose();
    } catch (e) {
      console.error(e);
      toast.show("error", `הייצוא נכשל: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} width={520}
      title={<span className="flex items-center gap-2">{format === "xlsx" ? <FileSpreadsheet size={17} className="text-emerald-600" /> : <FileText size={17} className="text-red-600" />}ייצוא ל-{FORMAT_LABEL[format]}</span>}
      footer={<>
        <button className="btn-primary" disabled={busy || !!error} onClick={() => void run()} data-testid="export-run">
          {busy ? <><Loader2 size={14} className="animate-spin" />מייצא…</> : <><Download size={14} />ייצוא</>}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={onClose}>ביטול</button>
        <span className="mr-auto text-[12px] text-ink-500" data-testid="export-summary">
          {error ? <span className="text-red-600">{error}</span> : `${model.rows.length} תכולות · ${model.timeline.weeks.length} שבועות`}
        </span>
      </>}>
      <div className="space-y-4" data-testid="export-dialog">
        <section>
          <div className="mb-1 flex items-center justify-between">
            <span className="label !mb-0">טווח שבועות</span>
            <span className="flex gap-1">
              <Chip on={isFull} onClick={() => { setFrom(full0); setTo(full1); }}>כל הגאנט</Chip>
              {view.time.kind !== "all" && <Chip on={isView} onClick={() => { setFrom(viewRange[0]); setTo(viewRange[1]); }}>המוצג כעת ({timeLabel(view.time)})</Chip>}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><div className="mb-0.5 text-[11.5px] text-ink-400">משבוע</div><WeekPicker id="export-from" value={from} onChange={setFrom} /></div>
            <div><div className="mb-0.5 text-[11.5px] text-ink-400">עד שבוע (כולל)</div><WeekPicker id="export-to" value={to} onChange={setTo} min={from} /></div>
          </div>
        </section>

        <section>
          <div className="mb-1 flex items-center justify-between">
            <span className="label !mb-0">תחומים</span>
            <span className="flex gap-1">
              <Chip on={domainIds.length === domainOpts.length} onClick={() => setDomainIds(domainOpts.map((o) => o.id))}>הכל</Chip>
              <Chip on={false} onClick={() => setDomainIds([])}>ניקוי</Chip>
            </span>
          </div>
          <div className="grid max-h-[200px] grid-cols-2 gap-x-3 gap-y-1 overflow-auto rounded-md border border-ink-200 p-2" data-testid="export-domains">
            {domainOpts.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-ink-50">
                <input type="checkbox" checked={domainIds.includes(o.id)} onChange={() => toggle(o.id)} data-domain={o.id} />
                <span className={clsx("truncate", o.id < 0 && "text-ink-500")}>{o.label}</span>
              </label>
            ))}
          </div>
          {active.length > 0 && (
            <p className="mt-1.5 text-[11.5px] text-ink-500">המסננים הפעילים יחולו גם על הייצוא: {active.join(" · ")}</p>
          )}
        </section>

        <section>
          <span className="label">תוספות</span>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={milestones} onChange={(e) => setMilestones(e.target.checked)} data-testid="export-milestones" />אבני דרך
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={sprints} onChange={(e) => setSprints(e.target.checked)} data-testid="export-sprints" />ספרינטים
            </label>
          </div>
        </section>

        {format === "pdf" && (
          <section>
            <span className="label">גודל דף (לרוחב)</span>
            <div className="flex gap-1.5" data-testid="export-page-size">
              {(["a3", "a4"] as const).map((p) => (
                <button key={p} type="button" onClick={() => setPageSize(p)} data-value={p}
                  className={clsx("flex-1 rounded-md border px-2 py-1.5 text-[12.5px]", pageSize === p ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 hover:bg-ink-50")}>
                  {p.toUpperCase()}{p === "a3" ? " — מומלץ לטווח ארוך" : ""}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={clsx("rounded-full border px-2 py-0.5 text-[11.5px]", on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-500 hover:bg-ink-50")}>
      {children}
    </button>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
}
