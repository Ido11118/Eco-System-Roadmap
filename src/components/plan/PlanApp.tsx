"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { GitCompareArrows, GanttChart, Pencil, Plus, Camera, Eye, AlertCircle, Loader2, Lock, RectangleHorizontal, Diamond, Flag, Users, User as UserIcon } from "lucide-react";
import type { Me, PlanData, SnapshotMeta, ViewConfig } from "@/lib/types";
import { useCatalog } from "@/components/CatalogProvider";
import { fmtDate, todayIL, isISODate } from "@/lib/weeks";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { TopBar } from "@/components/TopBar";
import { AppShell } from "@/components/AppShell";
import { GanttView, type GanttHandle } from "@/components/gantt/GanttView";
import { CompareView, type CompareHandle } from "@/components/gantt/CompareView";
import { TableView } from "@/components/table/TableView";
import { useLivePlan, readOnlyStore, type PlanStore } from "./store";
import { WorkspaceUIProvider, useWorkspaceUI } from "./ui";
import { FilterBar, type SavedView } from "./FilterBar";
import { defaultViewConfig, permissionDefaultDomains, revealFor, type Revealable } from "./filters";
import { currentPrefs, sanitizeView, savePrefs } from "./prefs";
import { locateItem } from "./locate";
import { DeletedItemsButton } from "./DeletedItems";

type Mode = "gantt" | "table" | "compare";
const MODES: Mode[] = ["gantt", "table", "compare"];
type SnapResp = { data: PlanData; revision: { revisionNo: number; createdAt: string } };

/** צד בהשוואה: המצב הנוכחי, או Snapshot (ואופציונלית גרסה מסוימת שלו). בכתובת: "live" / "12" / "12:34" */
type Side = { kind: "live" } | { kind: "snap"; id: number; rev: number | null };
function parseSide(v: string | null): Side | null {
  if (!v) return null;
  if (v === "live") return { kind: "live" };
  const [id, rev] = v.split(":").map(Number);
  return Number.isInteger(id) && id > 0 ? { kind: "snap", id, rev: Number.isInteger(rev) && rev > 0 ? rev : null } : null;
}
const sideKey = (s: Side) => (s.kind === "live" ? "live" : `${s.id}${s.rev ? `:${s.rev}` : ""}`);

export function PlanApp({ me }: { me: Me }) {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  // התצוגה: מהכתובת; אם לא צוינה — התצוגה האחרונה שבה המשתמש עבד (נשמרת אישית)
  const initialMode = useRef<Mode>(currentPrefs(me.preferences).lastMode ?? "gantt");
  const vp = params.get("view") as Mode | null;
  const mode: Mode = vp && MODES.includes(vp) ? vp : initialMode.current;
  useEffect(() => {
    if (currentPrefs(me.preferences).lastMode !== mode) savePrefs({ lastMode: mode });
  }, [mode, me.preferences]);

  const snapId = params.get("snap") ? Number(params.get("snap")) : null; // צפייה ב-Snapshot
  const snapRev = params.get("rev") ? Number(params.get("rev")) : null;
  // השוואה: שני צדדים. תאימות לאחור: base/brev = Snapshot מול המצב הנוכחי
  const legacyBase = params.get("base") ? `${params.get("base")}${params.get("brev") ? `:${params.get("brev")}` : ""}` : null;
  const sideA = parseSide(params.get("a") ?? legacyBase);
  const sideB = parseSide(params.get("b")) ?? { kind: "live" as const };
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
    queryFn: () => api<SnapResp>("GET", `/api/snapshots/${snapId}${snapRev ? `?rev=${snapRev}` : ""}`),
    enabled: !!snapId && mode !== "compare",
    staleTime: Infinity,
  });
  const sideQuery = (s: Side | null) => ({
    queryKey: ["snapshot", s?.kind === "snap" ? s.id : null, s?.kind === "snap" ? s.rev : null],
    queryFn: () => api<SnapResp>("GET", `/api/snapshots/${(s as { id: number }).id}${(s as { rev: number | null }).rev ? `?rev=${(s as { rev: number }).rev}` : ""}`),
    enabled: mode === "compare" && s?.kind === "snap",
    staleTime: Infinity,
  });
  const aQ = useQuery(sideQuery(sideA));
  const bQ = useQuery(sideQuery(sideB));

  // סדר הצדדים לפי תאריך: המוקדם = תכנון, המאוחר = ביצוע. המצב הנוכחי = היום.
  const today = todayIL();
  const sideInfo = (s: Side, q: typeof aQ) => {
    if (s.kind === "live") return { data: live.data, date: today, label: "מצב נוכחי", created: "9999", error: live.error };
    const meta = snapshots.data?.find((x) => x.id === s.id);
    return {
      data: q.data?.data, date: meta?.asOfDate ?? today, created: meta?.createdAt ?? "",
      label: `${meta?.name ?? `Snapshot #${s.id}`}${s.rev && q.data ? ` (גרסה ${q.data.revision.revisionNo})` : ""}`,
      error: q.error ? (q.error as Error).message : null,
    };
  };
  const cmp = useMemo(() => {
    if (mode !== "compare" || !sideA) return null;
    const A = sideInfo(sideA, aQ), B = sideInfo(sideB, bQ);
    const aFirst = A.date < B.date || (A.date === B.date && A.created <= B.created);
    return aFirst ? { plan: A, actual: B } : { plan: B, actual: A };
  }, [mode, sideA && sideKey(sideA), sideKey(sideB), aQ.data, bQ.data, aQ.error, bQ.error, live.data, snapshots.data, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // מצב השוואה הוא קריאה בלבד לכל המשתמשים — גם חלונית התכולה ו-Ctrl+Z לא יכולים לשנות נתונים.
  // חלונית התכולה מציגה את צד ה"ביצוע" של ההשוואה.
  const store: PlanStore = useMemo(() => (mode === "compare"
    ? readOnlyStore(me, cmp?.actual.data ?? live.data, live.loading, live.error)
    : snapId
      ? readOnlyStore(me, snapQ.data?.data, snapQ.isLoading, snapQ.error ? (snapQ.error as Error).message : null)
      : live), [snapId, mode, me, snapQ.data, snapQ.isLoading, snapQ.error, live, cmp]);

  // ---------- הגדרות תצוגה (אישיות, נשמרות בשרת לכל משתמש) ----------
  const [view, setViewState] = useState<ViewConfig>(() => {
    const prefs = currentPrefs(me.preferences);
    const base = defaultViewConfig(prefs);
    // ללא מצב שמור: ברירת מחדל לפי הרשאות — מי שעורך תחומים מסוימים רואה בהתחלה רק אותם
    return prefs.lastView ? sanitizeView(prefs.lastView, base) : { ...base, domainIds: permissionDefaultDomains(me) };
  });
  const viewsQ = useQuery({ queryKey: ["views"], queryFn: () => api<SavedView[]>("GET", "/api/views") });
  const appliedDefault = useRef(false);
  useEffect(() => {
    if (appliedDefault.current || !viewsQ.data) return;
    appliedDefault.current = true;
    const d = viewsQ.data.find((v) => v.isDefault); // תצוגת ברירת מחדל שהמשתמש בחר גוברת על המצב האחרון
    if (d) setViewState((cur) => sanitizeView(d.config, cur, live.data));
  }, [viewsQ.data, live.data]);
  const prefTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setView = useCallback((v: ViewConfig) => {
    setViewState(v);
    if (prefTimer.current) clearTimeout(prefTimer.current);
    prefTimer.current = setTimeout(() => {
      savePrefs({ lastView: v, showMilestones: v.showMilestones, showSprints: v.showSprints, density: v.density });
    }, 600);
  }, []);

  // ---------- חשיפה אחרי הוספה ----------
  // אם המשתמש הוסיף תכולה/אבן דרך/ספרינט שהסינון הנוכחי מסתיר — פותחים את הסינון כך שיוצג
  const viewRef = useRef(view);
  viewRef.current = view;
  const reveal = useCallback((x: Revealable) => {
    const d = live.data;
    if (!d) return;
    const r = revealFor(viewRef.current, d, x);
    if (!r) return;
    setView(r.view);
    toast.show("info", `הסינון עודכן כדי להציג את מה שנוסף (${r.changes.join(", ")})`);
  }, [live.data, setView, toast]);
  const workStore: PlanStore = useMemo(() => (store !== live ? store : {
    ...live,
    createItem: async (v) => {
      const it = await live.createItem(v);
      if (it) reveal({ kind: "item", teamId: it.teamId, status: it.status, priority: it.priority, name: it.name, notes: it.notes, startWeek: it.startWeek, endWeek: it.endWeek });
      return it;
    },
    createMilestone: async (v) => {
      const ok = await live.createMilestone(v);
      if (ok) reveal({ kind: "milestone", teamId: v.teamId, date: v.date });
      return ok;
    },
    createSprint: async (v) => {
      const ok = await live.createSprint(v);
      if (ok) reveal({ kind: "sprint", domainId: v.domainId, startDate: v.startDate, endDate: v.endDate });
      return ok;
    },
  }), [store, live, reveal]);

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
  const data = store.data;
  const cmpError = cmp?.plan.error ?? cmp?.actual.error ?? null;

  return (
    <WorkspaceUIProvider store={workStore} me={me}>
      <AppShell me={me} active={mode}>
        <TopBar me={me}>
          {mode !== "compare" && (
            <SourceSelect snapshots={snapshots.data ?? []} value={snapId} onChange={(id) => setParams({ snap: id ? String(id) : null, rev: null })} />
          )}
          {mode === "compare" && (
            <CompareSidesSelect snapshots={snapshots.data ?? []} a={sideA} b={sideB}
              onChange={(a, b) => setParams({ a: a ? sideKey(a) : null, b: sideKey(b), base: null, brev: null })} />
          )}
          <div className="mr-auto flex items-center gap-2">
            {mode === "compare" && (
              <button className="btn-secondary" onClick={() => router.push("/plan?view=gantt")} data-testid="compare-exit">
                <GanttChart size={14} />סיום וחזרה לגאנט
              </button>
            )}
            {mode !== "compare" && !snapId && !store.data?.teams.some((t) => store.canEditTeam(t.id)) && !store.canEditCross() && store.data && (
              <span className="flex items-center gap-1 text-[12px] text-ink-400" title="אין לך הרשאות עריכה"><Lock size={12} />צפייה בלבד</span>
            )}
            {!snapId && mode !== "compare" && live.data && (me.role === "SUPER" || me.domainIds.length > 0 || me.canEditCross) && <DeletedItemsButton data={live.data} />}
            {!snapId && mode !== "compare" && <SaveSnapshotButton isSuper={me.role === "SUPER"} />}
          </div>
        </TopBar>

        {snapId && mode !== "compare" && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[12.5px] text-amber-900" data-testid="snapshot-banner">
            <Eye size={14} />
            <span>צופה ב-Snapshot <b>{snapMeta?.name ?? `#${snapId}`}</b>{snapMeta ? ` (${fmtDate(snapMeta.asOfDate)})` : ""}{snapQ.data ? ` · גרסה ${snapQ.data.revision.revisionNo}` : ""} · לקריאה בלבד</span>
            {snapMeta?.canManage && (
              <button className="btn-ghost btn-sm mr-auto text-amber-900 hover:bg-amber-100" onClick={() => router.push(`/snapshots/${snapId}/edit`)} data-testid="banner-edit-snapshot">
                <Pencil size={13} />עריכת תמונת המצב
              </button>
            )}
            <button className={clsx("btn-ghost btn-sm text-amber-900 hover:bg-amber-100", !snapMeta?.canManage && "mr-auto")} onClick={() => setParams({ snap: null, rev: null })}>חזרה למצב הנוכחי</button>
          </div>
        )}

        {data && <FilterBar data={data} view={view} setView={setView} onToday={goToday} mode={mode}
          onLocate={(id) => { const msg = locateItem(id, data, view, setView, mode); if (msg) toast.show("info", msg); }} />}

        <main className="relative min-h-0 flex-1">
          {mode !== "compare" && store.loading && <Center><Loader2 className="animate-spin text-ink-400" /></Center>}
          {mode !== "compare" && store.error && <Center><div className="flex items-center gap-2 text-red-600"><AlertCircle size={16} />{store.error}</div></Center>}
          {data && mode === "gantt" && <GanttView ref={ganttRef} store={workStore} view={view} setView={setView} />}
          {data && mode === "table" && <TableView store={workStore} view={view} setView={setView} me={me} />}
          {mode === "compare" && (
            !sideA ? (
              <Center>
                <div className="max-w-md text-center">
                  <GitCompareArrows className="mx-auto mb-3 text-ink-300" size={36} />
                  <div className="text-[15px] font-semibold">תכנון מול ביצוע</div>
                  <p className="mt-1 text-ink-500">בחר מצב התחלתי (תמונת מצב). כברירת מחדל הוא יושווה למצב הנוכחי, ואפשר לבחור כמצב סופי גם תמונת מצב מאוחרת יותר. ההתאמה היא לפי ID של כל תכולה.</p>
                  {(snapshots.data?.length ?? 0) === 0 && <p className="mt-3 text-[12px] text-ink-400">עדיין לא נשמרו תמונות מצב.</p>}
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {snapshots.data?.slice(0, 8).map((s) => (
                      <button key={s.id} className="btn-secondary" onClick={() => setParams({ a: String(s.id), b: sideKey(sideB) })}>
                        {s.name} <span className="text-ink-400">· {fmtDate(s.asOfDate)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </Center>
            ) : cmpError ? <Center><span className="text-red-600">{cmpError}</span></Center>
              : cmp?.plan.data && cmp.actual.data ? (
                <CompareView ref={compareRef} current={cmp.actual.data} baseline={cmp.plan.data} view={view}
                  filterKey={compareFilter} onFilterKey={setCompareFilter}
                  planLabel={`${cmp.plan.label} · ${fmtDate(cmp.plan.date)}`} actualLabel={`${cmp.actual.label} · ${fmtDate(cmp.actual.date)}`} />
              ) : <Center><Loader2 className="animate-spin text-ink-400" /></Center>
          )}
        </main>
        {mode !== "table" && <Legend readOnly={store.readOnly || mode === "compare"} />}
        {mode !== "compare" && !snapId && <AddFab store={workStore} />}
      </AppShell>
    </WorkspaceUIProvider>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center p-6">{children}</div>;
}

function Legend({ readOnly }: { readOnly: boolean }) {
  const cat = useCatalog();
  return (
    <footer className="hidden flex-wrap items-center md:flex gap-x-4 gap-y-1 border-t border-ink-200 bg-white px-4 py-1.5 text-[11.5px] text-ink-500" data-testid="legend">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="legend-statuses">
        <span className="font-semibold text-ink-700">סטטוסים:</span>
        {cat.statuses.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className="inline-block h-3 w-5 rounded-[3px] border" style={{ background: s.bg, borderColor: s.border }} />
            {s.label}
          </span>
        ))}
      </div>
      <span className="h-4 w-px bg-ink-300" aria-hidden />
      <div className="flex items-center gap-x-3" data-testid="legend-layers">
        <span className="font-semibold text-ink-700">שכבות:</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-violet-600" />אבן דרך</span>
        <span className="flex items-center gap-1"><span className="sprint-band inline-block h-3 w-5" />ספרינט (לכל התחום)</span>
      </div>
      {readOnly ? <span className="mr-auto flex items-center gap-1"><Lock size={11} />קריאה בלבד</span>
        : <span className="mr-auto">לחיצה/גרירה על שורה מסמנת טווח ואז <b>+</b> להוספה · לחיצה כפולה = תכולה · גרור קובייה להזזה · קליק ימני לאפשרויות · <span className="kbd">Ctrl+Z</span> ביטול</span>}
    </footer>
  );
}

/** אפשרויות בחירה של תמונות מצב — בנפרד: משותפות (של מנהל המערכת) ושלי (אישיות) */
function SnapshotOptions({ snapshots }: { snapshots: SnapshotMeta[] }) {
  const shared = snapshots.filter((s) => s.scope === "shared"), mine = snapshots.filter((s) => s.scope === "personal");
  return (
    <>
      {shared.length > 0 && <optgroup label="תמונות מצב משותפות">
        {shared.map((s) => <option key={s.id} value={String(s.id)}>📷 {s.name} · {fmtDate(s.asOfDate)}</option>)}
      </optgroup>}
      {mine.length > 0 && <optgroup label="תמונות המצב שלי">
        {mine.map((s) => <option key={s.id} value={String(s.id)}>👤 {s.name} · {fmtDate(s.asOfDate)}</option>)}
      </optgroup>}
    </>
  );
}

function SourceSelect({ snapshots, value, onChange }: { snapshots: SnapshotMeta[]; value: number | null; onChange: (id: number | null) => void }) {
  return (
    <select className={clsx("input h-8 w-auto max-w-[260px] text-[12.5px]", value && "border-amber-400 bg-amber-50")} value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} data-testid="source-select" aria-label="מקור נתונים">
      <option value="">מצב נוכחי</option>
      <SnapshotOptions snapshots={snapshots} />
    </select>
  );
}

/** בחירת שני המצבים להשוואה. הסדר (תכנון/ביצוע) נקבע אוטומטית לפי תאריך כל מצב. */
/** "מאוחר יותר" בין שתי תמונות מצב: לפי תאריך המצב, ובאותו תאריך — לפי מועד השמירה */
function isAfter(x: SnapshotMeta, y: SnapshotMeta) {
  return x.asOfDate > y.asOfDate || (x.asOfDate === y.asOfDate && x.createdAt > y.createdAt);
}

/**
 * בחירת שני המצבים להשוואה:
 * מצב התחלתי (תכנון) — תמונת מצב; מצב סופי (ביצוע) — המצב הנוכחי (ברירת מחדל) או תמונת מצב מאוחרת יותר מההתחלתי.
 */
function CompareSidesSelect({ snapshots, a, b, onChange }: {
  snapshots: SnapshotMeta[]; a: Side | null; b: Side; onChange: (a: Side | null, b: Side) => void;
}) {
  const val = (s: Side | null) => (!s ? "" : s.kind === "live" ? "live" : String(s.id)); // גרסה מסוימת מוצגת כ-Snapshot עצמו
  const aMeta = a?.kind === "snap" ? snapshots.find((x) => x.id === a.id) : undefined;
  const laterThanA = aMeta ? snapshots.filter((x) => x.id !== aMeta.id && isAfter(x, aMeta)) : [];
  const pickA = (v: string) => {
    const na: Side | null = v ? { kind: "snap", id: Number(v), rev: null } : null;
    const naMeta = na ? snapshots.find((x) => x.id === Number(v)) : undefined;
    // אם המצב הסופי שנבחר כבר אינו מאוחר מההתחלתי החדש — חוזרים למצב הנוכחי
    const bMeta = b.kind === "snap" ? snapshots.find((x) => x.id === b.id) : undefined;
    const keepB = b.kind === "live" || (naMeta && bMeta && isAfter(bMeta, naMeta));
    onChange(na, keepB ? b : { kind: "live" });
  };
  return (
    <div className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
      <span>מצב התחלתי:</span>
      <select className="input h-8 w-auto max-w-[230px] text-[12.5px]" value={val(a)} onChange={(e) => pickA(e.target.value)} data-testid="compare-side-a" aria-label="מצב התחלתי (תכנון)">
        <option value="">בחר תמונת מצב…</option>
        <SnapshotOptions snapshots={snapshots} />
      </select>
      <span className="text-ink-300">←</span>
      <span>מצב סופי:</span>
      <select className="input h-8 w-auto max-w-[230px] text-[12.5px]" value={val(b)} disabled={!a}
        onChange={(e) => onChange(a, e.target.value === "live" ? { kind: "live" } : { kind: "snap", id: Number(e.target.value), rev: null })}
        data-testid="compare-side-b" aria-label="מצב סופי (ביצוע)" title={a ? "המצב הנוכחי, או תמונת מצב מאוחרת מהמצב ההתחלתי" : "בחר קודם מצב התחלתי"}>
        <option value="live">מצב נוכחי · היום</option>
        <SnapshotOptions snapshots={laterThanA} />
      </select>
    </div>
  );
}

/** כפתור הוספה צף (למטה משמאל): "+" שנפתח לתכולה / אבן דרך / ספרינט. הצבעים תואמים לצבעי השכבות בגאנט. */
function AddFab({ store }: { store: PlanStore }) {
  const ui = useWorkspaceUI();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  const data = store.data;
  const canTeam = !!data?.teams.some((t) => store.canEditTeam(t.id));
  const canDomain = !!data?.domains.some((d) => store.canEditDomain(d.id));
  const canAny = canTeam || store.canEditCross();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!data || !canAny) return null;
  const enter = () => { if (closeTimer.current) clearTimeout(closeTimer.current); if (!open) openedAt.current = Date.now(); setOpen(true); };
  const leave = () => { closeTimer.current = setTimeout(() => setOpen(false), 350); };
  const pick = (fn: () => void) => { setOpen(false); fn(); };
  const options = [
    { key: "item", label: "תכולה", icon: <RectangleHorizontal size={15} />, cls: "bg-brand-600 hover:bg-brand-700", run: () => ui.openNewItem(), enabled: canAny, testid: "add-item" },
    { key: "ms", label: "אבן דרך", icon: <Diamond size={14} />, cls: "bg-violet-600 hover:bg-violet-700", run: () => ui.openMilestone(null), enabled: canAny, testid: "add-milestone" },
    { key: "sprint", label: "ספרינט", icon: <Flag size={14} />, cls: "bg-teal-600 hover:bg-teal-700", run: () => ui.openSprint(null), enabled: canDomain, testid: "add-sprint" },
  ];
  return (
    // RTL: items-end = צמוד לקצה השמאלי — הכפתור לא זז כשהאפשרויות נפתחות. הסדר מלמעלה: תכולה, אבן דרך, ספרינט.
    <div ref={ref} className="fixed bottom-14 left-5 z-[60] flex flex-col items-end gap-2" onMouseEnter={enter} onMouseLeave={leave} data-testid="add-fab-menu">
      {open && options.map((o, i) => (
        <button key={o.key} disabled={!o.enabled} onClick={() => pick(o.run)} data-testid={o.testid}
          className={clsx("anim-in flex h-9 items-center gap-2 rounded-full pl-4 pr-3 text-[13px] font-medium text-white shadow-pop transition disabled:cursor-not-allowed disabled:opacity-40", o.cls)}
          style={{ animationDelay: `${(options.length - 1 - i) * 30}ms` }} title={o.enabled ? `הוספת ${o.label}` : "אין הרשאת עריכה לתחום"}>
          {o.icon}הוספת {o.label}
        </button>
      ))}
      <button aria-expanded={open} aria-label="הוספה" title="הוספה" data-testid="add-fab"
        // ריחוף פותח; לחיצה מיד אחרי הריחוף לא סוגרת שוב (אחרת התפריט "מהבהב" ונעלם)
        onClick={() => { if (!open) { openedAt.current = Date.now(); setOpen(true); } else if (Date.now() - openedAt.current > 600) setOpen(false); }}
        className={clsx("flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-pop transition hover:bg-brand-700", open && "rotate-45")}>
        <Plus size={22} />
      </button>
    </div>
  );
}

function SaveSnapshotButton({ isSuper }: { isSuper: boolean }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"shared" | "personal">(isSuper ? "shared" : "personal");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [asOf, setAsOf] = useState(todayIL());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const submit = async () => {
    if (!name.trim()) { toast.show("error", "יש להזין שם ל-Snapshot"); return; }
    if (!isISODate(asOf)) { toast.show("error", "תאריך לא תקין"); return; }
    setBusy(true);
    try {
      await api("POST", "/api/snapshots", { name: name.trim(), description: desc, asOfDate: asOf, scope });
      toast.show("success", `תמונת המצב "${name.trim()}" נשמרה`);
      qc.invalidateQueries({ queryKey: ["snapshots"] });
      setOpen(false); setName(""); setDesc(""); setAsOf(todayIL());
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
          {isSuper ? (
            <div>
              <div className="label">שיתוף</div>
              <div className="flex gap-1.5" data-testid="snapshot-scope">
                {([["shared", "משותפת לכולם", <Users key="u" size={13} />], ["personal", "אישית (רק לי)", <UserIcon key="p" size={13} />]] as const).map(([k, l, i]) => (
                  <button key={k} type="button" onClick={() => setScope(k)} data-value={k}
                    className={clsx("flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[12.5px]", scope === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 hover:bg-ink-50")}>
                    {i}{l}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 rounded-md bg-ink-50 px-2.5 py-1.5 text-[12px] text-ink-500"><UserIcon size={13} />תמונת מצב אישית — גלויה רק לך. תמונות מצב משותפות נוצרות ע״י מנהל המערכת.</p>
          )}
          <div><label className="label">שם *</label><input className="input" data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: Q4 2026 — תוכנית מאושרת" onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} data-testid="snapshot-name" /></div>
          <div>
            <label className="label">תאריך המצב</label>
            <input type="date" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} data-testid="snapshot-date" />
            <p className="mt-1 text-[11.5px] text-ink-400">בהשוואת תכנון מול ביצוע, המצב בעל התאריך המוקדם יותר משמש כתכנון. ניתן לשנות מאוחר יותר.</p>
          </div>
          <div><label className="label">תיאור</label><textarea className="input min-h-[70px]" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        </div>
      </Dialog>
    </>
  );
}
