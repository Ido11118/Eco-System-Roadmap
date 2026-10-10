"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Save, X, Loader2, Pencil, GanttChart, Table2 } from "lucide-react";
import type { Me, PlanData, ViewConfig } from "@/lib/types";
import { api } from "@/lib/api";
import { TopBar } from "@/components/TopBar";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog";
import { useDraftPlan } from "@/components/plan/store";
import { WorkspaceUIProvider } from "@/components/plan/ui";
import { FilterBar } from "@/components/plan/FilterBar";
import { defaultViewConfig } from "@/components/plan/filters";
import { currentPrefs } from "@/components/plan/prefs";
import { GanttView, type GanttHandle } from "@/components/gantt/GanttView";
import { TableView } from "@/components/table/TableView";

type SnapResp = { snapshot: { id: number; name: string; currentRevisionId: number }; revision: { id: number; revisionNo: number }; data: PlanData };

export function SnapshotEditor({ me, id }: { me: Me; id: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["snapshot-edit", id], queryFn: () => api<SnapResp>("GET", `/api/snapshots/${id}`), staleTime: Infinity, refetchOnWindowFocus: false });
  const { store, dirty, setDirty } = useDraftPlan(me, q.data?.data);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"gantt" | "table">("gantt");
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig(currentPrefs(me.preferences)));
  const ganttRef = useRef<GanttHandle>(null);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); store.undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const save = async () => {
    if (!q.data || !store.data) return;
    setBusy(true);
    try {
      const r = await api<{ revisionNo: number }>("POST", `/api/snapshots/${id}/revisions`, { baseRevisionId: q.data.revision.id, note: note.trim() || "עריכה", data: store.data });
      setDirty(false);
      toast.show("success", `נשמרה גרסה ${r.revisionNo}`);
      qc.invalidateQueries({ queryKey: ["snapshots"] });
      qc.invalidateQueries({ queryKey: ["snapshot", id] });
      router.push("/snapshots");
    } catch (e) { toast.show("error", (e as Error).message); }
    setBusy(false);
  };

  return (
    <WorkspaceUIProvider store={store} me={me}>
      <div className="flex h-screen w-full flex-col overflow-hidden">
        <TopBar me={me} active="snapshots">
          <div className="flex items-center rounded-lg bg-ink-100 p-0.5">
            {([["gantt", "גאנט", <GanttChart key="g" size={14} />], ["table", "תכולות", <Table2 key="t" size={14} />]] as const).map(([m, l, i]) => (
              <button key={m} onClick={() => setMode(m)} className={clsx("flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium", mode === m ? "bg-white shadow-sm" : "text-ink-500")}>{i}{l}</button>
            ))}
          </div>
        </TopBar>
        <div className="flex flex-wrap items-center gap-2 border-b border-violet-200 bg-violet-50 px-4 py-2 text-[12.5px] text-violet-900" data-testid="snapshot-editor-bar">
          <Pencil size={14} />
          <span>עריכת Snapshot <b>{q.data?.snapshot.name}</b> · מבוסס על גרסה {q.data?.revision.revisionNo}. השינויים יישמרו כגרסה חדשה; הגרסאות הקודמות נשמרות.</span>
          {dirty && <span className="rounded bg-violet-200 px-1.5 text-[11px]">יש שינויים שלא נשמרו</span>}
          <div className="mr-auto flex items-center gap-2">
            <input className="input h-7 w-[240px] bg-white" placeholder="הערה לגרסה (לדוגמה: תיקון תאריכים)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="revision-note" />
            <button className="btn-primary btn-sm" disabled={!dirty || busy} onClick={() => void save()} data-testid="save-revision"><Save size={13} />שמירה כגרסה חדשה</button>
            <button className="btn-secondary btn-sm" onClick={async () => {
              if (!dirty || await confirm({ title: "יציאה ללא שמירה", text: "השינויים שלא נשמרו יאבדו.", confirm: "יציאה", danger: true })) router.push("/snapshots");
            }}><X size={13} />ביטול</button>
          </div>
        </div>
        {store.data && <FilterBar data={store.data} view={view} setView={setView} onToday={() => ganttRef.current?.goToday()} mode={mode} />}
        <main className="relative min-h-0 flex-1">
          {!store.data && q.error && <div className="absolute inset-0 flex items-center justify-center text-red-600">{(q.error as Error).message}</div>}
          {!store.data && !q.error && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-ink-400" /></div>}
          {store.data && mode === "gantt" && <GanttView ref={ganttRef} store={store} view={view} />}
          {store.data && mode === "table" && <TableView store={store} view={view} me={me} />}
        </main>
      </div>
    </WorkspaceUIProvider>
  );
}
