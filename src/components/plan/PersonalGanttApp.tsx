"use client";
import { useMemo, useRef, useState } from "react";
import { Check, Lock, Loader2 } from "lucide-react";
import type { Me, ViewConfig } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { GanttView, type GanttHandle } from "@/components/gantt/GanttView";
import { personalGanttPlan } from "@/lib/personalGantt";
import { defaultViewConfig } from "./filters";
import { readOnlyStore, useLivePlan } from "./store";
import { WorkspaceUIProvider } from "./ui";
import { FilterBar } from "./FilterBar";
import { usePersonalGantt } from "./PersonalGanttActions";

export function PersonalGanttApp({ me }: { me: Me }) {
  const live = useLivePlan(me);
  const selection = usePersonalGantt(me);
  const [showSource, setShowSource] = useState(false);
  const [view, setViewState] = useState<ViewConfig>(() => ({ ...defaultViewConfig(), showMilestones: false, showSprints: false }));
  const setView = (v: ViewConfig) => setViewState({ ...v, showItems: true, showMilestones: false, showSprints: false });
  const gantt = useRef<GanttHandle>(null);
  const filterData = useMemo(() => live.data && selection.data
    ? personalGanttPlan(live.data, selection.data.ids, showSource, defaultViewConfig()) : undefined, [live.data, selection.data, showSource]);
  const data = useMemo(() => live.data && selection.data
    ? personalGanttPlan(live.data, selection.data.ids, showSource, view) : undefined, [live.data, selection.data, showSource, view]);
  const store = useMemo(() => ({ ...readOnlyStore(me, data, live.loading || selection.isPending, live.error || selection.error?.message || null), kind: "live" as const }),
    [me, data, live.loading, live.error, selection.isPending, selection.error]);
  const activeCount = live.data?.items.filter((i) => selection.data?.ids.includes(i.id)).length ?? 0;
  return <WorkspaceUIProvider store={store} me={me} personalGantt={{ ids: selection.data?.ids ?? [], showSource }}>
    <AppShell me={me} active="personal">
      <TopBar me={me}><h1 className="text-[15px] font-bold">הגאנט שלי</h1><span className="flex items-center gap-1 text-[12px] text-ink-500"><Lock size={13} />פרטי · מנהל המערכת בלבד</span></TopBar>
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-white px-4 py-2 text-[12.5px]">
        <span data-testid="personal-gantt-count">{activeCount} תכולות בגאנט שלי</span>
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showSource} onChange={(e) => setShowSource(e.target.checked)} data-testid="personal-show-source" />הצג גם את שאר התוכנית</label>
        <span className="mr-auto flex items-center gap-1 text-ink-500"><Check size={13} />בגאנט שלי{showSource ? " · שאר התכולות מוצגות בעמעום" : " · שורות ריקות מוסתרות"}</span>
      </div>
      {filterData && <FilterBar data={filterData} view={view} setView={setView} onToday={() => gantt.current?.goToday()} mode="gantt" itemsOnly />}
      <main className="relative min-h-0 flex-1" data-testid="personal-gantt-page">
        {store.loading ? <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-ink-400" /></div>
          : store.error ? <div role="alert" className="p-6 text-red-600">{store.error}<button className="btn-secondary mr-3" onClick={() => { live.refresh(); void selection.refetch(); }}>נסה שוב</button></div>
          : data && data.items.length > 0 ? <GanttView ref={gantt} store={store} view={view} setView={setView} />
          : <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="personal-gantt-empty">
            <p className="font-semibold">{activeCount ? "אין תכולות שמתאימות למסננים" : "עדיין אין תכולות פעילות בגאנט שלך"}</p>
            <p className="max-w-md text-[13px] text-ink-500">אפשר להוסיף תכולות בקליק ימני מהגאנט המקורי, או להציג כאן את שאר התוכנית ולבחור מתוכה. התכולות נשארות במקור ומתעדכנות כאן אוטומטית.</p>
            {!showSource && <button className="btn-primary" onClick={() => setShowSource(true)}>הצג את התוכנית לבחירת תכולות</button>}
          </div>}
      </main>
      <footer className="border-t border-ink-200 bg-white px-4 py-2 text-[12px] text-ink-500">קריאה בלבד · קליק ימני להוספה או להסרה מהבחירה הפרטית · Ctrl / Cmd / Shift + לחיצה לבחירה מרובה · עריכת התכולות מתבצעת במקור בלבד</footer>
    </AppShell>
  </WorkspaceUIProvider>;
}
