"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Search, ChevronRight, ChevronLeft, SlidersHorizontal, Bookmark, Check, Star, Trash2, Pencil, X, RotateCcw,
  RectangleHorizontal, Diamond, Flag,
} from "lucide-react";
import type { PlanData, TimeFilter, ViewConfig } from "@/lib/types";
import { useCatalog } from "@/components/CatalogProvider";
import { isISODate, todayIL, quarterOf, weekNumber, weekYear } from "@/lib/weeks";
import { api } from "@/lib/api";
import { MultiSelect, Floating } from "@/components/ui/popover";
import { useTooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog";
import { shiftTime, timeLabel, defaultViewConfig, CROSS_FILTER } from "./filters";
import { CROSS_ROW_LABELS } from "@/lib/constants";
import { sanitizeView, TEXT_SIZES, useTextSize, useBarFontSize, BAR_FONT } from "./prefs";
import { useMe } from "./ui";

export type SavedView = { id: number; name: string; config: ViewConfig; isDefault: boolean };

export function FilterBar({ data, view, setView, onToday, mode, onLocate }: {
  data: PlanData; view: ViewConfig; setView: (v: ViewConfig) => void; onToday: () => void; mode: "gantt" | "table" | "compare";
  onLocate?: (itemId: number) => void;
}) {
  const cat = useCatalog();
  // בגאנט ובהשוואה אפשר לסנן גם את השורות הרוחביות (בטבלה אין מידע רוחבי)
  const domainOpts = [
    ...data.domains.map((d) => ({ value: d.id, label: d.name, group: mode === "table" ? undefined : "תחומים" })),
    ...(mode === "table" ? [] : [
      { value: CROSS_FILTER.INFLUENCE, label: CROSS_ROW_LABELS.INFLUENCE, group: "רוחבי" },
      { value: CROSS_FILTER.CROSS_EVENT, label: CROSS_ROW_LABELS.CROSS_EVENT, group: "רוחבי" },
    ]),
  ];
  const teamOpts = data.teams
    .filter((t) => view.domainIds.length === 0 || view.domainIds.includes(t.domainId))
    .map((t) => ({ value: t.id, label: t.name, group: data.domains.find((d) => d.id === t.domainId)?.name }));
  const active = view.domainIds.length + view.teamIds.length + view.statuses.length + view.priorities.length + (view.search ? 1 : 0) + (view.time.kind !== "all" ? 1 : 0);
  return (
    // שורה אחת, זהה בגאנט ובטבלה (ההבדל היחיד: כפתורי השכבות בגאנט). כשאין מקום — שדה החיפוש מתכווץ, לא נוספת שורה.
    <div className="flex flex-nowrap items-center gap-1.5 border-b border-ink-200 bg-white px-4 py-2 [&>*]:shrink-0 [&>.search-box]:shrink" data-testid="filter-bar">
      <SearchBox data={data} value={view.search} onChange={(q) => setView({ ...view, search: q })} onLocate={onLocate} />
      <MultiSelect label="תחום" options={domainOpts} value={mode === "table" ? view.domainIds.filter((d) => d > 0) : view.domainIds} groups={mode !== "table"}
        onChange={(v) => setView({ ...view, domainIds: v, teamIds: view.teamIds.filter((t) => { const dom = data.teams.find((x) => x.id === t)?.domainId; return dom !== undefined && (v.length === 0 || v.includes(dom)); }) })} />
      <MultiSelect label="צוות" options={teamOpts} value={view.teamIds} groups onChange={(v) => setView({ ...view, teamIds: v })} />
      <MultiSelect label="סטטוס" options={cat.statuses.map((s) => ({ value: s.key, label: s.label }))} value={view.statuses}
        onChange={(v) => setView({ ...view, statuses: v })}
        renderOption={(o) => <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border" style={{ background: cat.status(o.value).bg, borderColor: cat.status(o.value).border }} />{o.label}</span>} />
      <MultiSelect label="תיעדוף" options={cat.priorities.map((p) => ({ value: p.key, label: p.label }))} value={view.priorities}
        onChange={(v) => setView({ ...view, priorities: v })} width={170} />
      <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
      <TimeControl value={view.time} onChange={(t) => setView({ ...view, time: t })} />
      {mode === "gantt" && <>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
        <LayerToggles view={view} setView={setView} mode={mode} />
      </>}
      {active > 0 && (
        <button className="btn-ghost btn-sm shrink-0 text-ink-500" aria-label="ניקוי מסננים" title="ניקוי מסננים"
          onClick={() => setView({ ...defaultViewConfig(), showItems: view.showItems, showMilestones: view.showMilestones, showSprints: view.showSprints, density: view.density })}>
          <RotateCcw size={12} />ניקוי
        </button>
      )}
      <div className="mr-auto flex shrink-0 items-center gap-1.5">
        <DisplayOptions view={view} setView={setView} mode={mode} />
        <SavedViews view={view} setView={setView} data={data} />
      </div>
    </div>
  );
}

/** חיפוש: מסנן (מעמעם בגאנט / מסתיר בטבלה) ומציג רשימת תוצאות — בחירה בתוצאה מאתרת את התכולה במסך */
function SearchBox({ data, value, onChange, onLocate }: {
  data: PlanData; value: string; onChange: (q: string) => void; onLocate?: (itemId: number) => void;
}) {
  const cat = useCatalog();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const q = value.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    const teamName = new Map(data.teams.map((t) => [t.id, t]));
    const domName = new Map(data.domains.map((d) => [d.id, d.name]));
    return data.items
      .filter((i) => i.name.toLowerCase().includes(q) || i.notes.toLowerCase().includes(q) || String(i.id) === q)
      .sort((a, b) => Number(!a.name.toLowerCase().includes(q)) - Number(!b.name.toLowerCase().includes(q)) || a.startWeek.localeCompare(b.startWeek))
      .slice(0, 12)
      .map((i) => {
        const t = i.teamId ? teamName.get(i.teamId) : undefined;
        const place = t ? (domName.get(t.domainId) === t.name ? t.name : `${domName.get(t.domainId)} / ${t.name}`) : "רוחבי";
        return { item: i, place };
      });
  }, [q, data]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const go = (id: number) => { setOpen(false); onLocate?.(id); };
  return (
    <div ref={ref} className="search-box relative min-w-[120px]">
      <Search size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400" />
      <input className="input h-7 w-[200px] max-w-full pr-7 text-[12.5px]" placeholder="חיפוש תכולה (שם, הערות, ID)…" value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} data-testid="search"
        onBlur={() => setTimeout(() => setOpen(false), 120) /* יציאה מהשדה סוגרת את הרשימה — שלא תסתיר כפתורים */}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === "Enter" && results[hi]) { e.preventDefault(); go(results[hi].item.id); }
          if (e.key === "Escape") setOpen(false);
        }} />
      {value && <button className="absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" onClick={() => onChange("")} aria-label="ניקוי חיפוש"><X size={13} /></button>}
      {open && q && onLocate && (
        <div className="anim-in absolute right-0 top-8 z-[90] w-[340px] overflow-hidden rounded-lg border border-ink-200 bg-white shadow-pop" data-testid="search-results">
          {results.length === 0 ? <div className="px-3 py-2.5 text-[12.5px] text-ink-400">לא נמצאו תכולות</div> : (
            <ul className="max-h-[320px] overflow-auto py-1">
              {results.map((r, i) => (
                <li key={r.item.id}>
                  <button onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault() /* שומר פוקוס בשדה עד הבחירה */} onClick={() => go(r.item.id)} data-result={r.item.id}
                    className={clsx("flex w-full items-center gap-2 px-3 py-1.5 text-start", i === hi && "bg-brand-50")}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm border" style={{ background: cat.status(r.item.status).bg, borderColor: cat.status(r.item.status).border }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-ink-900">{r.item.name}</span>
                      <span className="block truncate text-[11px] text-ink-500">{r.place} · שבועות {weekNumber(r.item.startWeek)}–{weekNumber(r.item.endWeek)} · {weekYear(r.item.startWeek)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-ink-100 bg-ink-50/60 px-3 py-1 text-[10.5px] text-ink-400"><span className="kbd">Enter</span> מעבר לתכולה · <span className="kbd">↑↓</span> בחירה</div>
        </div>
      )}
    </div>
  );
}

function TimeControl({ value, onChange }: { value: TimeFilter; onChange: (t: TimeFilter) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const today = todayIL();
  const y = Number(today.slice(0, 4));
  const [from, setFrom] = useState(value.kind === "dates" ? value.from : today);
  const [to, setTo] = useState(value.kind === "dates" ? value.to : today);
  const pick = (t: TimeFilter) => { onChange(t); setOpen(false); };
  const cq = quarterOf(today);
  return (
    <div className="flex items-center">
      <button className="icon-btn" disabled={value.kind === "all"} onClick={() => onChange(shiftTime(value, -1))} title="תקופה קודמת" aria-label="תקופה קודמת"><ChevronRight size={15} /></button>
      <button ref={btn} onClick={() => setOpen((o) => !o)} data-testid="time-filter"
        className={clsx("btn-secondary btn-sm min-w-[120px] font-normal", value.kind !== "all" && "border-brand-500 bg-brand-50 text-brand-700")}>
        <span className="text-ink-500">זמן:</span><span className="font-medium">{timeLabel(value)}</span>
      </button>
      <button className="icon-btn" disabled={value.kind === "all"} onClick={() => onChange(shiftTime(value, 1))} title="תקופה הבאה" aria-label="תקופה הבאה"><ChevronLeft size={15} /></button>
      <Floating anchor={btn.current} open={open} onClose={() => setOpen(false)}>
        <div className="w-[300px] p-2 text-[13px]">
          <div className="grid grid-cols-2 gap-1">
            {[
              { l: "כל התקופה", t: { kind: "all" } as TimeFilter },
              { l: "השבוע הנוכחי", t: { kind: "currentWeek" } as TimeFilter },
              { l: "החודש הנוכחי", t: { kind: "currentMonth" } as TimeFilter },
              { l: `הרבעון הנוכחי (Q${cq})`, t: { kind: "quarter", year: y, q: cq } as TimeFilter },
            ].map((o) => (
              <button key={o.l} className="rounded-md px-2 py-1.5 text-start hover:bg-ink-100" onClick={() => pick(o.t)}>{o.l}</button>
            ))}
          </div>
          <div className="mt-2 border-t border-ink-100 pt-2">
            <div className="label">רבעון</div>
            <div className="grid grid-cols-4 gap-1">
              {[y - 1, y, y + 1].flatMap((yy) => [1, 2, 3, 4].map((q) => (
                <button key={`${yy}-${q}`} onClick={() => pick({ kind: "quarter", year: yy, q })}
                  className={clsx("rounded px-1 py-1 text-[11.5px] hover:bg-ink-100", value.kind === "quarter" && value.year === yy && value.q === q && "bg-brand-100 text-brand-700")}>
                  Q{q} {String(yy).slice(2)}
                </button>
              )))}
            </div>
          </div>
          <div className="mt-2 border-t border-ink-100 pt-2">
            <div className="label">שנה</div>
            <div className="flex gap-1">
              {[y - 1, y, y + 1, y + 2].map((yy) => (
                <button key={yy} onClick={() => pick({ kind: "year", year: yy })}
                  className={clsx("flex-1 rounded px-1 py-1 text-[12px] hover:bg-ink-100", value.kind === "year" && value.year === yy && "bg-brand-100 text-brand-700")}>{yy}</button>
              ))}
            </div>
          </div>
          <div className="mt-2 border-t border-ink-100 pt-2">
            <div className="label">טווח מותאם (תאריכים / שבועות)</div>
            <div className="flex items-center gap-1">
              <input type="date" className="input h-7 text-[12px]" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-ink-400">–</span>
              <input type="date" className="input h-7 text-[12px]" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button className="btn-primary btn-sm mt-1.5 w-full" disabled={!isISODate(from) || !isISODate(to)}
              onClick={() => pick({ kind: "dates", from: from <= to ? from : to, to: from <= to ? to : from })}>החל טווח</button>
          </div>
        </div>
      </Floating>
    </div>
  );
}

/** הצגה/הסתרה של שכבות בגאנט: תכולות, אבני דרך, ספרינטים */
function LayerToggles({ view, setView, mode }: { view: ViewConfig; setView: (v: ViewConfig) => void; mode: string }) {
  const tip = useTooltip();
  const layers = [
    { key: "showItems" as const, on: view.showItems !== false, label: "תכולות", icon: <RectangleHorizontal size={14} />, cls: "border-brand-500 bg-brand-50 text-brand-700", testid: "toggle-items" },
    { key: "showMilestones" as const, on: view.showMilestones, label: "אבני דרך", icon: <Diamond size={13} />, cls: "border-violet-500 bg-violet-50 text-violet-700", testid: "toggle-milestones" },
    { key: "showSprints" as const, on: view.showSprints, label: "ספרינטים", icon: <Flag size={13} />, cls: "border-teal-500 bg-teal-50 text-teal-700", testid: "toggle-sprints" },
  ];
  if (mode !== "gantt") return null; // בטבלה ובהשוואה מוצגות תכולות בלבד
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-ink-200 p-0.5" role="group" aria-label="שכבות בגאנט: תכולות, אבני דרך, ספרינטים">
      {layers.map((l) => (
        <button key={l.key} type="button" aria-pressed={l.on} aria-label={`${l.on ? "הסתר" : "הצג"} ${l.label}`} data-testid={l.testid}
          onClick={(e) => { setView({ ...view, [l.key]: !l.on }); tip.show(`${l.on ? "הצג" : "הסתר"} ${l.label}`, e, { anchor: e.currentTarget, placement: "top" }); }}
          onMouseEnter={(e) => tip.show(`${l.on ? "הסתר" : "הצג"} ${l.label}`, e, { anchor: e.currentTarget, placement: "top", delay: 250 })}
          onMouseLeave={tip.hide}
          className={clsx("relative flex h-6 w-7 items-center justify-center rounded border transition",
            l.on ? l.cls : "border-transparent text-ink-300 hover:bg-ink-50 hover:text-ink-600")}>
          {l.icon}
          {!l.on && <span className="pointer-events-none absolute h-px w-4 rotate-[-35deg] bg-ink-300" />}
        </button>
      ))}
    </div>
  );
}

function DisplayOptions({ view, setView, mode }: { view: ViewConfig; setView: (v: ViewConfig) => void; mode: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const me = useMe();
  const [textSize, setTextSize] = useTextSize(me?.preferences ?? {});
  const [barFont, setBarFont] = useBarFontSize(me?.preferences ?? {});
  const Seg = <T extends string>({ value, options, onChange, testid }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; testid: string }) => (
    <div className="flex gap-1" data-testid={testid}>
      {options.map((o) => (
        <button key={o.key} onClick={() => onChange(o.key)} data-value={o.key}
          className={clsx("flex-1 rounded border px-1 py-1 text-[12px]", value === o.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 hover:bg-ink-50")}>
          {o.label}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <button ref={btn} className="btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} data-testid="display-options" title="אפשרויות תצוגה: גודל תצוגה וצפיפות"><SlidersHorizontal size={13} />תצוגה</button>
      <Floating anchor={btn.current} open={open} onClose={() => setOpen(false)} align="end">
        <div className="w-[260px] space-y-3 p-3 text-[13px]">
          <div>
            <div className="label">גודל תצוגה (טקסט וכל הממשק)</div>
            <Seg value={textSize} options={TEXT_SIZES} onChange={setTextSize} testid="text-size" />
          </div>
          {mode !== "table" && (
            <div>
              <div className="label flex items-center justify-between">
                <span>גודל הטקסט בקוביות</span>
                <span className="tabular-nums text-ink-700" data-testid="bar-font-value">{barFont}px</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-ink-400">א</span>
                <input type="range" min={BAR_FONT.min} max={BAR_FONT.max} step={1} value={barFont} className="flex-1 accent-brand-600"
                  onChange={(e) => setBarFont(Number(e.target.value))} aria-label="גודל הטקסט בקוביות" data-testid="bar-font" />
                <span className="text-[15px] text-ink-400">א</span>
              </div>
            </div>
          )}
          {mode !== "table" && (
            <div>
              <div className="label">צפיפות הגאנט (רוחב שבוע וגובה שורה)</div>
              <Seg value={view.density} onChange={(d) => setView({ ...view, density: d })} testid="density"
                options={[{ key: "compact", label: "צפופה" }, { key: "normal", label: "רגילה" }, { key: "wide", label: "מרווחת" }]} />
            </div>
          )}
        </div>
      </Floating>
    </>
  );
}

function SavedViews({ view, setView, data }: { view: ViewConfig; setView: (v: ViewConfig) => void; data: PlanData }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const q = useQuery({ queryKey: ["views"], queryFn: () => api<SavedView[]>("GET", "/api/views") });
  const views = useMemo(() => q.data ?? [], [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["views"] });
  const save = async () => {
    if (!newName.trim()) return;
    try { await api("POST", "/api/views", { name: newName.trim(), config: view }); setNewName(""); refresh(); toast.show("success", "התצוגה נשמרה"); }
    catch (e) { toast.show("error", (e as Error).message); }
  };
  return (
    <>
      <button ref={btn} className="btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} data-testid="saved-views" title="תצוגות שמורות"><Bookmark size={13} />שמורות</button>
      <Floating anchor={btn.current} open={open} onClose={() => { setOpen(false); setRenaming(null); }} align="end">
        <div className="w-[300px] p-2 text-[13px]">
          <div className="max-h-[260px] overflow-auto">
            {views.length === 0 && <div className="px-2 py-2 text-ink-400">אין תצוגות שמורות עדיין.</div>}
            {views.map((v) => (
              <div key={v.id} className="group flex items-center gap-1 rounded-md px-1 hover:bg-ink-100">
                {renaming?.id === v.id ? (
                  <input autoFocus className="input h-7 flex-1" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") { try { await api("PATCH", `/api/views/${v.id}`, { name: renaming.name }); refresh(); } catch (er) { toast.show("error", (er as Error).message); } setRenaming(null); }
                      if (e.key === "Escape") setRenaming(null);
                    }} />
                ) : (
                  <button className="flex flex-1 items-center gap-1.5 truncate py-1.5 text-start" onClick={() => { setView(sanitizeView(v.config, view, data)); setOpen(false); toast.show("info", `נטענה התצוגה "${v.name}"`); }}>
                    {v.isDefault && <Star size={12} className="shrink-0 fill-amber-400 text-amber-400" />}
                    <span className="truncate">{v.name}</span>
                  </button>
                )}
                <button className="icon-btn h-6 w-6 opacity-0 group-hover:opacity-100" title={v.isDefault ? "בטל ברירת מחדל" : "קבע כברירת מחדל"}
                  onClick={async () => { await api("PATCH", `/api/views/${v.id}`, { isDefault: !v.isDefault }); refresh(); }}><Star size={12} /></button>
                <button className="icon-btn h-6 w-6 opacity-0 group-hover:opacity-100" title="שינוי שם" onClick={() => setRenaming({ id: v.id, name: v.name })}><Pencil size={12} /></button>
                <button className="icon-btn h-6 w-6 opacity-0 group-hover:opacity-100 hover:text-red-600" title="מחיקה"
                  onClick={async () => { if (await confirm({ title: "מחיקת תצוגה", text: `למחוק את "${v.name}"?`, confirm: "מחיקה", danger: true })) { await api("DELETE", `/api/views/${v.id}`); refresh(); } }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-ink-100 pt-2">
            <div className="label">שמירת התצוגה הנוכחית</div>
            <div className="flex gap-1">
              <input className="input h-7" placeholder="לדוגמה: סטטוס שבועי" value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void save(); }} data-testid="view-name" />
              <button className="btn-primary btn-sm" onClick={() => void save()} disabled={!newName.trim()}><Check size={13} /></button>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-400">כוללת מסננים, טווח זמן ואפשרויות תצוגה. התצוגות אישיות.</p>
          </div>
        </div>
      </Floating>
    </>
  );
}

export { X };
