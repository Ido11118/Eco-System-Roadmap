"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { GanttChart, Table2, GitCompareArrows, Plus, Camera, Eye, AlertCircle, Loader2, Lock } from "lucide-react";
import type { Me, PlanData, SnapshotMeta, ViewConfig } from "@/lib/types";
import { STATUSES, STATUS_META } from "@/lib/constants";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { TopBar } from "@/components/TopBar";
import { GanttView, type GanttHandle } from "@/components/gantt/GanttView";
import { CompareView, type CompareHandle } from "@/components/gantt/CompareView";
import { TableView } from "@/components/table/TableView";
import { useLivePlan, readOnlyStore, type PlanStore } from "./store";
import { WorkspaceUIProvider, useWorkspaceUI, fmtTs } from "./ui";
import { FilterBar, type SavedView } from "./FilterBar";
import { defaultViewConfig } from "./filters";
import { currentPrefs, sanitizeView, savePrefs } from "./prefs";

type Mode = "gantt" | "table" | "compare";

export function PlanApp({ me }: { me: Me }) {
  const params = useSearchParams();
  const router = useRouter();
  const mode = (params.get("view") as Mode) || "gantt";
  const snapId = params.get("snap") ? Number(params.get("snap")) : null; // צפייה ב-Snapshot
  const snapRev = params.get("rev") ? Number(params.get("rev")) : null;
  const baseId = params.get("base") ? Number(params.get("base")) : null; // Baseline להשוואה
  const baseRev = params.get("brev") ? Number(params.get("brev")) : null;
  const [compareFilter, setCompareFilter] = useState("all");

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null) p.delete(k); else p.set(k, v); }
    router.replace(`/plan?${p.toString()}`, { scroll: false });
  }, [params, router]);

  const live = useLivePlan(me);
  const snapshots = useQuery({ queryKey: ["snapshots"], queryFn: () => api<SnapshotMeta[]>("GET", "/api/snapshots") });
  const snapQ = useQuery({
    queryKey: ["snapshot", snapId, snapRev],
    queryFn: () => api<{ data: PlanData; revision: { revisionNo: number; createdAt: string } }>("GET", `/api/snapshots/${snapId}${snapRev ? `?rev=${snapRev}` : ""}`),
    enabled: !!snapId,
    staleTime: Infinity,
  });
  const baseQ = useQuery({
    queryKey: ["snapshot", baseId, baseRev],
    queryFn: () => api<{ data: PlanData; revision: { revisionNo: number } }>("GET", `/api/snapshots/${baseId}${baseRev ? `?rev=${baseRev}` : ""}`),
    enabled: mode === "compare" && !!baseId,
    staleTime: Infinity,
  });

  // מצב השוואה הוא קריאה בלבד לכל המשתמשים — גם חלונית התכולה ו-Ctrl+Z לא יכולים לשנות נתונים
  const store: PlanStore = useMemo(() => (mode === "compare"
    ? readOnlyStore(me, live.data, live.loading, live.error)
    : snapId
      ? readOnlyStore(me, snapQ.data?.data, snapQ.isLoading, snapQ.error ? (snapQ.error as Error).message : null)
      : live), [snapId, mode, me, snapQ.data, snapQ.isLoading, snapQ.error, live]);

  // ---------- הגדרות תצוגה (אישיות) ----------
  const [view, setViewState] = useState<ViewConfig>(() => defaultViewConfig(currentPrefs(me.preferences)));
  const viewsQ = useQuery({ queryKey: ["views"], queryFn: () => api<SavedView[]>("GET", "/api/views") });
  const appliedDefault = useRef(false);
  useEffect(() => {
    if (appliedDefault.current || !viewsQ.data) return;
    appliedDefault.current = true;
    const d = viewsQ.data.find((v) => v.isDefault);
    if (d) setViewState((cur) => sanitizeView(d.config, cur, live.data));
  }, [viewsQ.data, me.preferences]);
  const prefTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setView = useCallback((v: ViewConfig) => {
    setViewState((prev) => {
      if (prev.showMilestones !== v.showMilestones || prev.showSprints !== v.showSprints || prev.density !== v.density) {
        if (prefTimer.current) clearTimeout(prefTimer.current);
        prefTimer.current = setTimeout(() => {
          savePrefs({ showMilestones: v.showMilestones, showSprints: v.showSprints, density: v.density });
        }, 400);
      }
      return v;
    });
  }, []);

  // ---------- קיצורי מקלדת ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); store.undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const ganttRef = useRef<GanttHandle>(null);
  const compareRef = useRef<CompareHandle>(null);
  const goToday = () => (mode === "compare" ? compareRef.current?.goToday() : ganttRef.current?.goToday());

  const snapMeta = snapshots.data?.find((s) => s.id === snapId);
  const baseMeta = snapshots.data?.find((s) => s.id === baseId);
  const data = store.data;

  return (
    <WorkspaceUIProvider store={store} me={me}>
      <div className="flex h-screen w-full flex-col overflow-hidden">
        <TopBar me={me} active="plan">
          <div className="flex items-center rounded-lg bg-ink-100 p-0.5" role="tablist">
            {([
              { m: "gantt", l: "גאנט", i: <GanttChart size={14} /> },
              { m: "table", l: "תכולות", i: <Table2 size={14} /> },
              { m: "compare", l: "תכנון מול ביצוע", i: <GitCompareArrows size={14} /> },
            ] as const).map((t) => (
              <button key={t.m} role="tab" aria-selected={mode === t.m} data-testid={`mode-${t.m}`}
                onClick={() => setParams({ view: t.m === "gantt" ? null : t.m })}
                className={clsx("flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium transition",
                  mode === t.m ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900")}>
                {t.i}{t.l}
              </button>
            ))}
          </div>
          {mode !== "compare" && (
            <SourceSelect snapshots={snapshots.data ?? []} value={snapId} onChange={(id) => setParams({ snap: id ? String(id) : null, rev: null })} />
          )}
          {mode === "compare" && (
            <BaselineSelect snapshots={snapshots.data ?? []} value={baseId} onChange={(id) => setParams({ base: id ? String(id) : null, brev: null })} />
          )}
          <div className="mr-auto flex items-center gap-2">
            {mode !== "compare" && !snapId && (
              <AddButton store={store} />
            )}
            {me.role === "SUPER" && !snapId && mode !== "compare" && <SaveSnapshotButton />}
          </div>
        </TopBar>

        {snapId && mode !== "compare" && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[12.5px] text-amber-900" data-testid="snapshot-banner">
            <Eye size={14} />
            <span>צופה ב-Snapshot <b>{snapMeta?.name ?? `#${snapId}`}</b>{snapQ.data ? ` · גרסה ${snapQ.data.revision.revisionNo}` : ""} · לקריאה בלבד</span>
            <button className="btn-ghost btn-sm mr-auto text-amber-900 hover:bg-amber-100" onClick={() => setParams({ snap: null, rev: null })}>חזרה למצב הנוכחי</button>
          </div>
        )}

        {data && <FilterBar data={data} view={view} setView={setView} onToday={goToday} mode={mode} />}

        <main className="relative min-h-0 flex-1">
          {store.loading && <Center><Loader2 className="animate-spin text-ink-400" /></Center>}
          {store.error && <Center><div className="flex items-center gap-2 text-red-600"><AlertCircle size={16} />{store.error}</div></Center>}
          {data && mode === "gantt" && <GanttView ref={ganttRef} store={store} view={view} />}
          {data && mode === "table" && <TableView store={store} view={view} me={me} />}
          {mode === "compare" && live.data && (
            !baseId ? (
              <Center>
                <div className="max-w-md text-center">
                  <GitCompareArrows className="mx-auto mb-3 text-ink-300" size={36} />
                  <div className="text-[15px] font-semibold">תכנון מול ביצוע</div>
                  <p className="mt-1 text-ink-500">בחר Snapshot שישמש כ-Baseline. המערכת תשווה בין התכנון שנשמר בו לבין המצב הנוכחי, לפי ID של כל תכולה.</p>
                  {(snapshots.data?.length ?? 0) === 0 && <p className="mt-3 text-[12px] text-ink-400">עדיין לא נשמרו תמונות מצב.</p>}
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {snapshots.data?.slice(0, 6).map((s) => (
                      <button key={s.id} className="btn-secondary" onClick={() => setParams({ base: String(s.id) })}>{s.name}</button>
                    ))}
                  </div>
                </div>
              </Center>
            ) : baseQ.data ? (
              <CompareView ref={compareRef} current={live.data} baseline={baseQ.data.data} view={view}
                filterKey={compareFilter} onFilterKey={setCompareFilter} baselineLabel={baseMeta?.name ?? "Snapshot"} />
            ) : baseQ.error ? <Center><span className="text-red-600">{(baseQ.error as Error).message}</span></Center>
              : <Center><Loader2 className="animate-spin text-ink-400" /></Center>
          )}
        </main>
        {mode !== "table" && <Legend readOnly={store.readOnly || mode === "compare"} />}
      </div>
    </WorkspaceUIProvider>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center p-6">{children}</div>;
}

function Legend({ readOnly }: { readOnly: boolean }) {
  return (
    <footer className="hidden flex-wrap items-center md:flex gap-x-3 gap-y-1 border-t border-ink-200 bg-white px-4 py-1.5 text-[11.5px] text-ink-500" data-testid="legend">
      <span className="font-semibold text-ink-700">מקרא:</span>
      {STATUSES.map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded-[3px] border" style={{ background: STATUS_META[s].bg, borderColor: STATUS_META[s].border }} />
          {STATUS_META[s].label}
        </span>
      ))}
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-violet-600" />אבן דרך</span>
      <span className="flex items-center gap-1"><span className="inline-block h-3 w-5 rounded-sm border border-teal-300 bg-teal-50" />ספרינט</span>
      {readOnly ? <span className="mr-auto flex items-center gap-1"><Lock size={11} />קריאה בלבד</span>
        : <span className="mr-auto">גרור על שורה ליצירת תכולה · גרור קובייה להזזה · קליק ימני לאפשרויות · <span className="kbd">Ctrl+Z</span> ביטול</span>}
    </footer>
  );
}

function SourceSelect({ snapshots, value, onChange }: { snapshots: SnapshotMeta[]; value: number | null; onChange: (id: number | null) => void }) {
  return (
    <select className={clsx("input h-8 w-auto max-w-[260px] text-[12.5px]", value && "border-amber-400 bg-amber-50")} value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} data-testid="source-select" aria-label="מקור נתונים">
      <option value="">מצב נוכחי</option>
      {snapshots.length > 0 && <optgroup label="תמונות מצב שמורות">
        {snapshots.map((s) => <option key={s.id} value={s.id}>📷 {s.name}</option>)}
      </optgroup>}
    </select>
  );
}

function BaselineSelect({ snapshots, value, onChange }: { snapshots: SnapshotMeta[]; value: number | null; onChange: (id: number | null) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
      Baseline:
      <select className="input h-8 w-auto max-w-[260px] text-[12.5px]" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} data-testid="baseline-select">
        <option value="">בחר Snapshot…</option>
        {snapshots.map((s) => <option key={s.id} value={s.id}>{s.name} ({fmtTs(s.createdAt).split(",")[0]})</option>)}
      </select>
    </label>
  );
}

function AddButton({ store }: { store: PlanStore }) {
  const ui = useWorkspaceUI();
  const data = store.data;
  const any = !!data && (store.canEditCross() || data.teams.some((t) => store.canEditTeam(t.id)));
  if (!any) return <span className="flex items-center gap-1 text-[12px] text-ink-400" title="אין לך הרשאות עריכה"><Lock size={12} />צפייה בלבד</span>;
  return (
    <div className="flex items-center gap-1">
      <button className="btn-primary" onClick={() => ui.openNewItem()} data-testid="add-item"><Plus size={15} />הוסף תכולה</button>
      <button className="btn-secondary" onClick={() => ui.openMilestone(null)} title="אבן דרך חדשה">◆ אבן דרך</button>
      <button className="btn-secondary" onClick={() => ui.openSprint(null)} title="ספרינט חדש" disabled={!data?.teams.some((t) => store.canEditTeam(t.id))}>ספרינט</button>
    </div>
  );
}

function SaveSnapshotButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const submit = async () => {
    if (!name.trim()) { toast.show("error", "יש להזין שם ל-Snapshot"); return; }
    setBusy(true);
    try {
      await api("POST", "/api/snapshots", { name: name.trim(), description: desc });
      toast.show("success", `תמונת המצב "${name.trim()}" נשמרה`);
      qc.invalidateQueries({ queryKey: ["snapshots"] });
      setOpen(false); setName(""); setDesc("");
    } catch (e) { toast.show("error", (e as Error).message); }
    setBusy(false);
  };
  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)} data-testid="save-snapshot"><Camera size={14} />שמור תמונת מצב</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="שמירת תמונת מצב (Snapshot)"
        footer={<><button className="btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? "שומר…" : "שמירה"}</button><button className="btn-secondary" onClick={() => setOpen(false)}>ביטול</button></>}>
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-500">יישמר עותק מלא של מצב התוכנית הנוכחי: תכולות, שורות, אבני דרך, ספרינטים, מידע רוחבי ומבנה התחומים. התוכנית הנוכחית לא תשתנה.</p>
          <div><label className="label">שם *</label><input className="input" data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: Q4 2026 — תוכנית מאושרת" onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} data-testid="snapshot-name" /></div>
          <div><label className="label">תיאור</label><textarea className="input min-h-[70px]" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        </div>
      </Dialog>
    </>
  );
}
