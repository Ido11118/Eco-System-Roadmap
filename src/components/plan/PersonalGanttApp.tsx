"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Lock, Loader2 } from "lucide-react";
import type { Me, RowDTO, ViewConfig } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { GanttView, type GanttHandle } from "@/components/gantt/GanttView";
import { PRIVATE_TEAM, withPrivateWorkspace } from "@/lib/privateWorkspace";
import { Dialog } from "@/components/ui/dialog";
import { usePrivateWorkspace } from "./usePrivateWorkspace";
import { personalGanttPlan } from "@/lib/personalGantt";
import { defaultViewConfig, revealFor } from "./filters";
import { readOnlyStore, useLivePlan } from "./store";
import { WorkspaceUIProvider, useWorkspaceUI } from "./ui";
import { FilterBar } from "./FilterBar";
import { usePersonalGantt } from "./PersonalGanttActions";

export function PersonalGanttApp({ me }: { me: Me }) {
  const live = useLivePlan(me);
  const selection = usePersonalGantt(me);
  const workspace = usePrivateWorkspace(me);
  const [trash, setTrash] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [view, setViewState] = useState<ViewConfig>(() => ({ ...defaultViewConfig(), showMilestones: false, showSprints: false }));
  const setView = (v: ViewConfig) => setViewState({ ...v, showItems: true, showMilestones: false, showSprints: false });
  const gantt = useRef<GanttHandle>(null);
  const filterData = useMemo(() => live.data && selection.data && workspace.data
    ? withPrivateWorkspace(personalGanttPlan(live.data, selection.data.ids, showSource, defaultViewConfig()), workspace.data, defaultViewConfig()) : undefined,
    [live.data, selection.data, workspace.data, showSource]);
  const data = useMemo(() => live.data && selection.data && workspace.data
    ? withPrivateWorkspace(personalGanttPlan(live.data, selection.data.ids, showSource, view), workspace.data, view) : undefined,
    [live.data, selection.data, workspace.data, showSource, view]);
  const store = useMemo(() => ({ ...readOnlyStore(me, data, live.loading || selection.isPending || workspace.isPending,
    live.error || selection.error?.message || workspace.error?.message || null), kind: "live" as const, readOnly: false,
    ...workspace.controls, canEditTeam: (id: number | null) => id === PRIVATE_TEAM,
    createItem: async (v: Parameters<typeof workspace.controls.createItem>[0]) => {
      const item = await workspace.controls.createItem(v);
      if (item && filterData) setViewState((current) => revealFor(current, filterData, { kind: "item", ...item, rowKind: "TEAM" })?.view ?? current);
      return item;
    },
    canEditRow: (row: RowDTO | undefined) => row?.teamId === PRIVATE_TEAM,
    refresh: () => { live.refresh(); void workspace.refetch(); },
  }), [me, data, filterData, live.loading, live.error, selection.isPending, selection.error, workspace.isPending, workspace.error, workspace.controls]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey && !(e.target as HTMLElement).closest("input, textarea, select, [contenteditable]") && !document.querySelector("[role=dialog]")) {
        e.preventDefault(); store.undo();
      }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [store.undo]);
  const activeCount = live.data?.items.filter((i) => selection.data?.ids.includes(i.id)).length ?? 0;
  return <WorkspaceUIProvider store={store} me={me} personalGantt={{ ids: selection.data?.ids ?? [], showSource }}>
    <AppShell me={me} active="personal">
      <TopBar me={me}><h1 className="text-[15px] font-bold">הגאנט שלי</h1><span className="flex items-center gap-1 text-[12px] text-ink-500"><Lock size={13} />פרטי · מנהל המערכת בלבד</span></TopBar>
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-white px-4 py-2 text-[12.5px]">
        <span data-testid="personal-gantt-count">{activeCount} תכולות מהמקור · {workspace.data?.items.length ?? 0} תכולות פרטיות</span>
        <AddPrivateItemButton disabled={!data || store.loading || !!store.error} />
        <button className="btn-ghost btn-sm" onClick={() => setTrash(true)} data-testid="private-trash">תכולות פרטיות שנמחקו ({workspace.data?.deletedItems.length ?? 0})</button>
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showSource} onChange={(e) => setShowSource(e.target.checked)} data-testid="personal-show-source" />הצג גם את שאר התוכנית</label>
        <span className="mr-auto flex items-center gap-1 text-ink-500"><Check size={13} />בגאנט שלי{showSource ? " · שאר התכולות מוצגות בעמעום" : " · שורות ריקות במקור מוסתרות"}</span>
      </div>
      {filterData && <FilterBar data={filterData} view={view} setView={setView} onToday={() => gantt.current?.goToday()} mode="gantt" itemsOnly />}
      <main className="relative flex min-h-0 flex-1 flex-col" data-testid="personal-gantt-page">
        {store.loading ? <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-ink-400" /></div>
          : store.error ? <div role="alert" className="p-6 text-red-600">{store.error}<button className="btn-secondary mr-3" onClick={() => { live.refresh(); void selection.refetch(); void workspace.refetch(); }}>נסה שוב</button></div>
          : data ? <>
            {!activeCount && !showSource && <div className="border-b border-ink-100 px-4 py-2 text-[12px] text-ink-500" data-testid="personal-gantt-empty">אפשר להוסיף כאן תכולות פרטיות בגאנט עמר, או לבחור תכולות מהתוכנית המשותפת. <button className="text-brand-700 underline" onClick={() => setShowSource(true)}>הצג את התוכנית לבחירה</button></div>}
            <div className="min-h-0 flex-1"><GanttView ref={gantt} store={store} view={view} setView={setView} /></div></>
          : null}
      </main>
      <footer className="border-t border-ink-200 bg-white px-4 py-2 text-[12px] text-ink-500">גאנט עמר ניתן לעריכה וגלוי רק לך · התכולות מהתוכנית המשותפת לקריאה בלבד · Ctrl / Cmd / Shift + לחיצה לבחירה מרובה · Ctrl / Cmd + Z לביטול פעולה פרטית</footer>
      {trash && <Dialog open onClose={() => setTrash(false)} title="תכולות פרטיות שנמחקו">
        <div className="space-y-2">{!workspace.data?.deletedItems.length && <p className="text-ink-500">אין תכולות פרטיות שנמחקו</p>}
          {workspace.data?.deletedItems.map((i) => <div key={i.id} className="flex items-center gap-2 border-b border-ink-100 py-2"><span className="flex-1 truncate">{i.name}</span><button className="btn-secondary btn-sm" onClick={() => void workspace.restoreItems([i])} data-restore-private={i.id}>שחזור</button></div>)}
        </div>
      </Dialog>}
    </AppShell>
  </WorkspaceUIProvider>;
}

function AddPrivateItemButton({ disabled }: { disabled: boolean }) {
  const ui = useWorkspaceUI();
  return <button className="btn-primary btn-sm" data-testid="add-private-item" disabled={disabled} onClick={() => ui.openNewItem({ teamId: PRIVATE_TEAM })}>הוספת תכולה פרטית</button>;
}
