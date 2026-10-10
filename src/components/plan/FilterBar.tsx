"use client";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Search, ChevronRight, ChevronLeft, CalendarClock, SlidersHorizontal, Bookmark, Check, Star, Trash2, Pencil, X, RotateCcw,
} from "lucide-react";
import type { PlanData, TimeFilter, ViewConfig } from "@/lib/types";
import { STATUSES, STATUS_META, PRIORITIES, PRIORITY_META } from "@/lib/constants";
import { isISODate, todayIL, quarterOf } from "@/lib/weeks";
import { api } from "@/lib/api";
import { MultiSelect, Floating } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog";
import { shiftTime, timeLabel, defaultViewConfig } from "./filters";
import { sanitizeView } from "./prefs";

export type SavedView = { id: number; name: string; config: ViewConfig; isDefault: boolean };

export function FilterBar({ data, view, setView, onToday, mode }: {
  data: PlanData; view: ViewConfig; setView: (v: ViewConfig) => void; onToday: () => void; mode: "gantt" | "table" | "compare";
}) {
  const domainOpts = data.domains.map((d) => ({ value: d.id, label: d.name }));
  const teamOpts = data.teams
    .filter((t) => view.domainIds.length === 0 || view.domainIds.includes(t.domainId))
    .map((t) => ({ value: t.id, label: t.name, group: data.domains.find((d) => d.id === t.domainId)?.name }));
  const active = view.domainIds.length + view.teamIds.length + view.statuses.length + view.priorities.length + (view.search ? 1 : 0) + (view.time.kind !== "all" ? 1 : 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-200 bg-white px-4 py-2" data-testid="filter-bar">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400" />
        <input className="input h-7 w-[200px] pr-7 text-[12.5px]" placeholder="חיפוש בשם ובהערות…" value={view.search}
          onChange={(e) => setView({ ...view, search: e.target.value })} data-testid="search" />
      </div>
      <MultiSelect label="תחום" options={domainOpts} value={view.domainIds}
        onChange={(v) => setView({ ...view, domainIds: v, teamIds: view.teamIds.filter((t) => { const dom = data.teams.find((x) => x.id === t)?.domainId; return dom !== undefined && (v.length === 0 || v.includes(dom)); }) })} />
      <MultiSelect label="צוות" options={teamOpts} value={view.teamIds} groups onChange={(v) => setView({ ...view, teamIds: v })} />
      <MultiSelect label="סטטוס" options={STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))} value={view.statuses}
        onChange={(v) => setView({ ...view, statuses: v })}
        renderOption={(o) => <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border" style={{ background: STATUS_META[o.value].bg, borderColor: STATUS_META[o.value].border }} />{o.label}</span>} />
      <MultiSelect label="תיעדוף" options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }))} value={view.priorities}
        onChange={(v) => setView({ ...view, priorities: v })} width={170} />
      <span className="mx-1 h-5 w-px bg-ink-200" />
      <TimeControl value={view.time} onChange={(t) => setView({ ...view, time: t })} />
      {mode !== "table" && (
        <button className="btn-secondary btn-sm" onClick={onToday} data-testid="go-today"><CalendarClock size={13} />חזרה להיום</button>
      )}
      {active > 0 && (
        <button className="btn-ghost btn-sm text-ink-500" onClick={() => setView({ ...defaultViewConfig(), showMilestones: view.showMilestones, showSprints: view.showSprints, density: view.density })}>
          <RotateCcw size={12} />ניקוי מסננים
        </button>
      )}
      <div className="mr-auto flex items-center gap-1.5">
        <DisplayOptions view={view} setView={setView} mode={mode} />
        <SavedViews view={view} setView={setView} data={data} />
      </div>
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

function DisplayOptions({ view, setView, mode }: { view: ViewConfig; setView: (v: ViewConfig) => void; mode: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const Toggle = ({ on, label, onClick, testid }: { on: boolean; label: string; onClick: () => void; testid?: string }) => (
    <button className="flex w-full items-center justify-between rounded-md px-2 py-1.5 hover:bg-ink-100" onClick={onClick} data-testid={testid}>
      <span>{label}</span>
      <span className={clsx("relative h-4 w-7 rounded-full transition", on ? "bg-brand-600" : "bg-ink-300")}>
        <span className={clsx("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all", on ? "left-0.5" : "left-3.5")} />
      </span>
    </button>
  );
  return (
    <>
      <button ref={btn} className="btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} data-testid="display-options"><SlidersHorizontal size={13} />אפשרויות תצוגה</button>
      <Floating anchor={btn.current} open={open} onClose={() => setOpen(false)} align="end">
        <div className="w-[240px] p-1.5 text-[13px]">
          <Toggle on={view.showMilestones} label="הצג אבני דרך" onClick={() => setView({ ...view, showMilestones: !view.showMilestones })} testid="toggle-milestones" />
          <Toggle on={view.showSprints} label="הצג ספרינטים" onClick={() => setView({ ...view, showSprints: !view.showSprints })} testid="toggle-sprints" />
          {mode !== "table" && (
            <div className="mt-1 border-t border-ink-100 px-2 pt-2">
              <div className="label">צפיפות</div>
              <div className="flex gap-1">
                {(["compact", "normal", "wide"] as const).map((d) => (
                  <button key={d} onClick={() => setView({ ...view, density: d })}
                    className={clsx("flex-1 rounded border px-1 py-1 text-[12px]", view.density === d ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 hover:bg-ink-50")}>
                    {d === "compact" ? "צפופה" : d === "normal" ? "רגילה" : "מרווחת"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="px-2 pb-1 pt-2 text-[11px] text-ink-400">ההגדרות נשמרות באופן אישי ואינן משפיעות על משתמשים אחרים.</p>
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
      <button ref={btn} className="btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} data-testid="saved-views"><Bookmark size={13} />תצוגות שמורות</button>
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
