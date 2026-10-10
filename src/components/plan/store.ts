"use client";
// PlanStore — ממשק אחיד לקריאה ועדכון של נתוני תוכנית.
// לתוכנית החיה (API + Optimistic Updates) ולטיוטת עריכת Snapshot (מקומית) יש מימושים שונים,
// אבל כל התצוגות (גאנט, טבלה, חלונית תכולה) עובדות מול אותו ממשק — מקור נתונים אחד.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { replaceEqualDeep, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiErr } from "@/lib/api";
import type { ItemDTO, Me, MilestoneDTO, PlanData, RowDTO, SprintDTO } from "@/lib/types";
import type { Status, PriorityT } from "@/lib/constants";
import { useToast } from "@/components/ui/toast";

export type ItemPatch = Partial<Pick<ItemDTO, "name" | "status" | "priority" | "notes" | "startWeek" | "endWeek" | "rowId">>;
export type NewItem = { rowId: number; name: string; startWeek: string; endWeek: string; status?: Status; priority?: PriorityT; notes?: string };
export type MsInput = { name: string; date: string; teamId: number | null; notes?: string };
export type SprintInput = { name: string; startDate: string; endDate: string; teamId: number; notes?: string };

export interface PlanStore {
  kind: "live" | "draft" | "snapshot";
  data: PlanData | undefined;
  loading: boolean;
  error: string | null;
  readOnly: boolean;
  canEditTeam: (teamId: number | null) => boolean;
  canEditCross: () => boolean;
  canEditRow: (row: RowDTO | undefined) => boolean;
  createItem: (v: NewItem) => Promise<ItemDTO | null>;
  updateItem: (item: ItemDTO, patch: ItemPatch, opts?: { undoLabel?: string; silent?: boolean }) => Promise<boolean>;
  bulkUpdate: (items: ItemDTO[], patch: { status?: Status; priority?: PriorityT }) => Promise<boolean>;
  deleteItem: (item: ItemDTO) => Promise<void>;
  createRow: (teamId: number, anchorRowId?: number, position?: "above" | "below") => Promise<number | null>;
  deleteRow: (row: RowDTO, opts?: { silent?: boolean }) => Promise<void>;
  createMilestone: (v: MsInput) => Promise<boolean>;
  updateMilestone: (m: MilestoneDTO, patch: Partial<MsInput>) => Promise<boolean>;
  deleteMilestone: (m: MilestoneDTO) => Promise<boolean>;
  createSprint: (v: SprintInput) => Promise<boolean>;
  updateSprint: (s: SprintDTO, patch: Partial<SprintInput>) => Promise<boolean>;
  deleteSprint: (s: SprintDTO) => Promise<boolean>;
  undo: () => void;
  refresh: () => void;
}

/** בדיקת חפיפה בצד הלקוח (משוב מיידי); השרת אוכף את אותו כלל */
export function findOverlap(data: PlanData, rowId: number, start: string, end: string, exceptId?: number): ItemDTO | undefined {
  const row = data.rows.find((r) => r.id === rowId);
  if (!row || row.kind !== "TEAM") return undefined;
  return data.items.find((i) => i.rowId === rowId && i.id !== exceptId && i.startWeek <= end && i.endWeek >= start);
}

function teamDomainOf(data: PlanData | undefined, teamId: number | null) {
  return data?.teams.find((t) => t.id === teamId)?.domainId;
}

function makePerms(me: Me, data: PlanData | undefined, readOnly: boolean) {
  const canEditTeam = (teamId: number | null) => {
    if (readOnly) return false;
    if (teamId === null) return me.role === "SUPER" || me.canEditCross;
    if (me.role === "SUPER") return true;
    const d = teamDomainOf(data, teamId);
    return d !== undefined && me.domainIds.includes(d);
  };
  const canEditCross = () => !readOnly && (me.role === "SUPER" || me.canEditCross);
  const canEditRow = (row: RowDTO | undefined) => !!row && (row.kind === "TEAM" ? canEditTeam(row.teamId) : canEditCross());
  return { canEditTeam, canEditCross, canEditRow };
}

type UndoOp = { label: string; run: () => Promise<boolean>; done?: boolean };

// ---------------------------------------------------------------------------
// תוכנית חיה
// ---------------------------------------------------------------------------
export const PLAN_KEY = ["plan"];

/**
 * מיזוג תוצאת רענון: לעולם לא מחזירים ישות לגרסה ישנה יותר ממה שכבר במטמון (מגן מפני תשובת polling שהגיעה באיחור).
 * replaceEqualDeep שומר על אותם אובייקטים כשלא השתנה דבר — כך ה-polling לא מרנדר מחדש את הגאנט והטבלה לשווא.
 */
function mergeFresh(oldData: unknown, newData: unknown): unknown {
  const o = oldData as PlanData | undefined, n = newData as PlanData | undefined;
  if (!o || !n) return newData;
  const keepNewer = <T extends { id: number; version: number }>(oa: T[], na: T[]) => {
    const om = new Map(oa.map((x) => [x.id, x]));
    return na.map((x) => { const prev = om.get(x.id); return prev && prev.version > x.version ? prev : x; });
  };
  return replaceEqualDeep(o, { ...n, items: keepNewer(o.items, n.items), milestones: keepNewer(o.milestones, n.milestones), sprints: keepNewer(o.sprints, n.sprints) });
}

export function useLivePlan(me: Me): PlanStore {
  const qc = useQueryClient();
  const toast = useToast();
  const pending = useRef(0); // מספר עדכונים בתהליך — בזמן זה ה-polling מושהה
  const q = useQuery({
    queryKey: PLAN_KEY,
    queryFn: () => api<PlanData>("GET", "/api/plan"),
    refetchInterval: () => (pending.current > 0 ? false : 10000), // סנכרון תקופתי עם עריכות של משתמשים אחרים
    refetchIntervalInBackground: false,
    structuralSharing: mergeFresh,
  });
  const data = q.data;
  const dataRef = useRef(data);
  dataRef.current = data;
  const undoStack = useRef<UndoOp[]>([]);
  const perms = useMemo(() => makePerms(me, data, false), [me, data]);

  const setData = useCallback((fn: (d: PlanData) => PlanData) => {
    qc.setQueryData<PlanData>(PLAN_KEY, (d) => (d ? fn(d) : d));
  }, [qc]);

  /** עטיפת כל עדכון: ביטול רענון שבדרך (כדי שלא ידרוס את העדכון האופטימי) והשהיית ה-polling עד הסיום */
  const track = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    pending.current++;
    try {
      await qc.cancelQueries({ queryKey: PLAN_KEY });
      return await fn();
    } finally {
      pending.current--;
    }
  }, [qc]);

  const fail = useCallback((e: unknown) => {
    const err = e as ApiErr;
    toast.show("error", err?.message ?? "השמירה נכשלה");
    // בכל כישלון — רענון מהשרת כדי לחזור למצב אמת (כולל עדכון של משתמש אחר)
    void qc.invalidateQueries({ queryKey: PLAN_KEY });
  }, [qc, toast]);

  const runUndo = useCallback(async (op: UndoOp) => {
    if (op.done) return;
    op.done = true; // מונע הרצה כפולה (גם מכפתור ההודעה וגם מ-Ctrl+Z)
    undoStack.current = undoStack.current.filter((x) => x !== op);
    let ok = false;
    try { ok = await op.run(); } catch (e) { fail(e); return; }
    if (ok) toast.show("info", `בוטל: ${op.label}`);
  }, [fail, toast]);

  const pushUndo = useCallback((op: UndoOp, showToast = true) => {
    undoStack.current.push(op);
    if (undoStack.current.length > 30) undoStack.current.shift();
    if (showToast) toast.show("success", op.label, { action: { label: "ביטול", run: () => { void runUndo(op); } } });
  }, [toast, runUndo]);

  const replaceItem = useCallback((it: ItemDTO) => setData((d) => ({ ...d, items: d.items.map((x) => (x.id === it.id ? it : x)) })), [setData]);
  const curItem = (id: number) => dataRef.current?.items.find((x) => x.id === id);

  const updateItemRef = useRef<PlanStore["updateItem"]>(async () => false);
  const updateItem: PlanStore["updateItem"] = useCallback((item, patch, opts) => track(async () => {
    const d = dataRef.current;
    if (d && (patch.startWeek || patch.endWeek || patch.rowId)) {
      const clash = findOverlap(d, patch.rowId ?? item.rowId, patch.startWeek ?? item.startWeek, patch.endWeek ?? item.endWeek, item.id);
      if (clash) { toast.show("error", `הטווח חופף לתכולה "${clash.name}" באותה שורה`); return false; }
    }
    const before: ItemPatch = {};
    for (const k of Object.keys(patch) as (keyof ItemPatch)[]) (before as Record<string, unknown>)[k] = item[k];
    const newTeam = patch.rowId ? d?.rows.find((r) => r.id === patch.rowId)?.teamId ?? item.teamId : item.teamId;
    replaceItem({ ...item, ...patch, teamId: newTeam }); // Optimistic
    try {
      const upd = await api<ItemDTO>("PATCH", `/api/items/${item.id}`, { version: item.version, patch });
      replaceItem(upd);
      if (opts?.undoLabel) {
        pushUndo({ label: opts.undoLabel, run: async () => {
          const cur = curItem(item.id);
          return cur ? updateItemRef.current(cur, before, { silent: true }) : false;
        } }, !opts.silent);
      } else if (!opts?.silent) toast.show("success", "נשמר");
      return true;
    } catch (e) { fail(e); return false; }
  }), [fail, pushUndo, replaceItem, toast, track]);
  updateItemRef.current = updateItem;

  const createItem: PlanStore["createItem"] = useCallback((v) => track(async () => {
    const d = dataRef.current;
    if (d) {
      const clash = findOverlap(d, v.rowId, v.startWeek, v.endWeek);
      if (clash) { toast.show("error", `הטווח חופף לתכולה "${clash.name}" באותה שורה`); return null; }
    }
    try {
      const it = await api<ItemDTO>("POST", "/api/items", v);
      setData((d) => ({ ...d, items: [...d.items, it] }));
      pushUndo({ label: `נוספה תכולה "${it.name}"`, run: () => track(async () => {
        const cur = curItem(it.id);
        // מחיקה עם בדיקת גרסה — אם מישהו ערך בינתיים, הביטול נדחה ולא נמחק מידע
        await api("DELETE", `/api/items/${it.id}?version=${cur?.version ?? it.version}`);
        setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== it.id) }));
        return true;
      }) });
      return it;
    } catch (e) { fail(e); return null; }
  }), [fail, pushUndo, setData, toast, track]);

  const bulkUpdate: PlanStore["bulkUpdate"] = useCallback((items, patch) => track(async () => {
    for (const it of items) replaceItem({ ...it, ...patch });
    try {
      const upd = await api<ItemDTO[]>("POST", "/api/items/bulk", { entries: items.map((i) => ({ id: i.id, version: i.version })), patch });
      const byId = new Map(upd.map((u) => [u.id, u]));
      setData((d) => ({ ...d, items: d.items.map((x) => byId.get(x.id) ?? x) }));
      toast.show("success", `עודכנו ${upd.length} תכולות`);
      return true;
    } catch (e) { fail(e); return false; }
  }), [fail, replaceItem, setData, toast, track]);

  const deleteItem: PlanStore["deleteItem"] = useCallback((item) => track(async () => {
    const cur = curItem(item.id) ?? item;
    setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== item.id) }));
    try {
      await api("DELETE", `/api/items/${item.id}?version=${cur.version}`);
      pushUndo({ label: `נמחקה תכולה "${item.name}"`, run: () => track(async () => {
        const it = await api<ItemDTO>("POST", `/api/items/${item.id}/restore`);
        setData((d) => ({ ...d, items: [...d.items.filter((x) => x.id !== it.id), it] }));
        return true;
      }) });
    } catch (e) { fail(e); }
  }), [fail, pushUndo, setData, track]);

  const createRow: PlanStore["createRow"] = useCallback((teamId, anchorRowId, position) => track(async () => {
    try {
      const row = await api<RowDTO>("POST", "/api/rows", { teamId, anchorRowId, position });
      setData((d) => ({ ...d, rows: [...d.rows, row] }));
      pushUndo({ label: "נוספה שורה", run: () => track(async () => {
        await api("DELETE", `/api/rows/${row.id}?ifEmpty=1`); // אם מישהו הוסיף לשורה תוכן בינתיים — הביטול נדחה
        setData((d) => ({ ...d, rows: d.rows.filter((r) => r.id !== row.id), items: d.items.filter((i) => i.rowId !== row.id) }));
        return true;
      }) }, false);
      return row.id;
    } catch (e) { fail(e); return null; }
  }), [fail, pushUndo, setData, track]);

  const deleteRow: PlanStore["deleteRow"] = useCallback((row, opts) => track(async () => {
    const removed = dataRef.current?.items.filter((i) => i.rowId === row.id) ?? [];
    setData((d) => ({ ...d, rows: d.rows.filter((r) => r.id !== row.id), items: d.items.filter((i) => i.rowId !== row.id) }));
    try {
      await api("DELETE", `/api/rows/${row.id}${removed.length ? "" : "?ifEmpty=1"}`);
      if (opts?.silent) return;
      pushUndo({ label: removed.length ? `השורה נמחקה (כולל ${removed.length} תכולות)` : "השורה נמחקה", run: () => track(async () => {
        await api("POST", `/api/rows/${row.id}/restore`);
        await qc.invalidateQueries({ queryKey: PLAN_KEY });
        return true;
      }) });
    } catch (e) { fail(e); }
  }), [fail, pushUndo, qc, setData, track]);

  const createMilestone: PlanStore["createMilestone"] = useCallback((v) => track(async () => {
    try {
      const m = await api<MilestoneDTO>("POST", "/api/milestones", v);
      setData((d) => ({ ...d, milestones: [...d.milestones, m] }));
      toast.show("success", "אבן הדרך נוספה");
      return true;
    } catch (e) { fail(e); return false; }
  }), [fail, setData, toast, track]);
  const updateMilestone: PlanStore["updateMilestone"] = useCallback((m, patch) => track(async () => {
    try {
      const u = await api<MilestoneDTO>("PATCH", `/api/milestones/${m.id}`, { version: m.version, patch });
      setData((d) => ({ ...d, milestones: d.milestones.map((x) => (x.id === u.id ? u : x)) }));
      toast.show("success", "נשמר");
      return true;
    } catch (e) { fail(e); return false; }
  }), [fail, setData, toast, track]);
  const deleteMilestone: PlanStore["deleteMilestone"] = useCallback((m) => track(async () => {
    setData((d) => ({ ...d, milestones: d.milestones.filter((x) => x.id !== m.id) }));
    try {
      await api("DELETE", `/api/milestones/${m.id}`);
      pushUndo({ label: `נמחקה אבן דרך "${m.name}"`, run: () => track(async () => {
        await api("POST", `/api/milestones/${m.id}/restore`); await qc.invalidateQueries({ queryKey: PLAN_KEY }); return true;
      }) });
      return true;
    } catch (e) { fail(e); return false; }
  }), [fail, pushUndo, qc, setData, track]);

  const createSprint: PlanStore["createSprint"] = useCallback((v) => track(async () => {
    try {
      const s = await api<SprintDTO>("POST", "/api/sprints", v);
      setData((d) => ({ ...d, sprints: [...d.sprints, s] }));
      toast.show("success", "הספרינט נוסף");
      return true;
    } catch (e) { fail(e); return false; }
  }), [fail, setData, toast, track]);
  const updateSprint: PlanStore["updateSprint"] = useCallback((s, patch) => track(async () => {
    try {
      const u = await api<SprintDTO>("PATCH", `/api/sprints/${s.id}`, { version: s.version, patch });
      setData((d) => ({ ...d, sprints: d.sprints.map((x) => (x.id === u.id ? u : x)) }));
      toast.show("success", "נשמר");
      return true;
    } catch (e) { fail(e); return false; }
  }), [fail, setData, toast, track]);
  const deleteSprint: PlanStore["deleteSprint"] = useCallback((s) => track(async () => {
    setData((d) => ({ ...d, sprints: d.sprints.filter((x) => x.id !== s.id) }));
    try {
      await api("DELETE", `/api/sprints/${s.id}`);
      pushUndo({ label: `נמחק ספרינט "${s.name}"`, run: () => track(async () => {
        await api("POST", `/api/sprints/${s.id}/restore`); await qc.invalidateQueries({ queryKey: PLAN_KEY }); return true;
      }) });
      return true;
    } catch (e) { fail(e); return false; }
  }), [fail, pushUndo, qc, setData, track]);

  const undo = useCallback(() => {
    const op = undoStack.current[undoStack.current.length - 1];
    if (!op) { toast.show("info", "אין פעולה לביטול"); return; }
    void runUndo(op);
  }, [toast, runUndo]);
  const refresh = useCallback(() => { void qc.invalidateQueries({ queryKey: PLAN_KEY }); }, [qc]);
  const errMsg = q.error ? (q.error as Error).message : null;

  // אובייקט יציב — מונע רינדור מחדש של כל הגאנט/טבלה בכל רינדור של ההורה
  return useMemo<PlanStore>(() => ({
    kind: "live", data, loading: q.isLoading, error: errMsg, readOnly: false,
    ...perms, createItem, updateItem, bulkUpdate, deleteItem, createRow, deleteRow,
    createMilestone, updateMilestone, deleteMilestone, createSprint, updateSprint, deleteSprint,
    undo, refresh,
  }), [data, q.isLoading, errMsg, perms, createItem, updateItem, bulkUpdate, deleteItem, createRow, deleteRow,
    createMilestone, updateMilestone, deleteMilestone, createSprint, updateSprint, deleteSprint, undo, refresh]);
}

// ---------------------------------------------------------------------------
// תצוגת Snapshot (קריאה בלבד)
// ---------------------------------------------------------------------------
const noop = async () => {};
const no = async () => false;
export function readOnlyStore(me: Me, data: PlanData | undefined, loading: boolean, error: string | null): PlanStore {
  return {
    kind: "snapshot", data, loading, error, readOnly: true,
    ...makePerms(me, data, true),
    createItem: async () => null, updateItem: async () => false, bulkUpdate: async () => false,
    deleteItem: noop, createRow: async () => null, deleteRow: noop, createMilestone: no, updateMilestone: no, deleteMilestone: no,
    createSprint: no, updateSprint: no, deleteSprint: no, undo: () => {}, refresh: () => {},
  };
}

// ---------------------------------------------------------------------------
// טיוטת עריכת Snapshot (Super User) — שינויים מקומיים עד "שמירה כגרסה חדשה"
// ---------------------------------------------------------------------------
export function useDraftPlan(me: Me, initial: PlanData | undefined) {
  const toast = useToast();
  const [data, setDataState] = useState<PlanData | undefined>(initial);
  const [dirty, setDirty] = useState(false);
  const history = useRef<PlanData[]>([]);
  const seq = useRef(-1);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => { setDataState(initial); setDirty(false); history.current = []; }, [initial]);

  const commit = useCallback((fn: (d: PlanData) => PlanData) => {
    const cur = dataRef.current;
    if (!cur) return;
    history.current.push(cur);
    if (history.current.length > 50) history.current.shift();
    const next = fn(cur);
    dataRef.current = next;
    setDataState(next);
    setDirty(true);
  }, []);
  const nid = () => seq.current--;
  const now = () => new Date().toISOString();
  const perms = makePerms({ ...me, role: "SUPER" }, data, false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store: PlanStore = useMemo(() => ({
    kind: "draft", data, loading: !data, error: null, readOnly: false, ...perms,
    createItem: async (v) => {
      const d = dataRef.current!;
      const clash = findOverlap(d, v.rowId, v.startWeek, v.endWeek);
      if (clash) { toast.show("error", `הטווח חופף לתכולה "${clash.name}" באותה שורה`); return null; }
      const row = d.rows.find((r) => r.id === v.rowId)!;
      const it: ItemDTO = {
        id: nid(), name: v.name, rowId: v.rowId, teamId: row.teamId, startWeek: v.startWeek, endWeek: v.endWeek,
        status: v.status ?? "PLANNED", priority: v.priority ?? "NONE", notes: v.notes ?? "", version: 1,
        createdAt: now(), createdById: me.id, updatedAt: now(), updatedById: me.id,
      };
      commit((d) => ({ ...d, items: [...d.items, it] }));
      return it;
    },
    updateItem: async (item, patch) => {
      const d = dataRef.current!;
      if (patch.startWeek || patch.endWeek || patch.rowId) {
        const clash = findOverlap(d, patch.rowId ?? item.rowId, patch.startWeek ?? item.startWeek, patch.endWeek ?? item.endWeek, item.id);
        if (clash) { toast.show("error", `הטווח חופף לתכולה "${clash.name}" באותה שורה`); return false; }
      }
      const teamId = patch.rowId ? d.rows.find((r) => r.id === patch.rowId)?.teamId ?? item.teamId : item.teamId;
      commit((d) => ({ ...d, items: d.items.map((x) => (x.id === item.id ? { ...x, ...patch, teamId, updatedAt: now(), updatedById: me.id } : x)) }));
      return true;
    },
    bulkUpdate: async (items, patch) => {
      const ids = new Set(items.map((i) => i.id));
      commit((d) => ({ ...d, items: d.items.map((x) => (ids.has(x.id) ? { ...x, ...patch } : x)) }));
      return true;
    },
    deleteItem: async (item) => commit((d) => ({ ...d, items: d.items.filter((x) => x.id !== item.id) })),
    createRow: async (teamId, anchorRowId, position = "below") => {
      const id = nid();
      commit((d) => {
        const rows = d.rows.filter((r) => r.kind === "TEAM" && r.teamId === teamId).sort((a, b) => a.sortOrder - b.sortOrder);
        const idx = anchorRowId ? rows.findIndex((r) => r.id === anchorRowId) : -1;
        let so: number;
        if (idx === -1) so = (rows[rows.length - 1]?.sortOrder ?? 0) + 1000;
        else if (position === "above") so = idx === 0 ? rows[0].sortOrder - 1000 : (rows[idx - 1].sortOrder + rows[idx].sortOrder) / 2;
        else so = idx === rows.length - 1 ? rows[idx].sortOrder + 1000 : (rows[idx].sortOrder + rows[idx + 1].sortOrder) / 2;
        return { ...d, rows: [...d.rows, { id, kind: "TEAM", teamId, sortOrder: so, version: 1 }] };
      });
      return id;
    },
    deleteRow: async (row) => commit((d) => ({ ...d, rows: d.rows.filter((r) => r.id !== row.id), items: d.items.filter((i) => i.rowId !== row.id) })),
    createMilestone: async (v) => { commit((d) => ({ ...d, milestones: [...d.milestones, { id: nid(), ...v, notes: v.notes ?? "", version: 1, createdById: me.id, createdAt: now(), updatedAt: now(), updatedById: me.id }] })); return true; },
    updateMilestone: async (m, p) => { commit((d) => ({ ...d, milestones: d.milestones.map((x) => (x.id === m.id ? { ...x, ...p } : x)) })); return true; },
    deleteMilestone: async (m) => { commit((d) => ({ ...d, milestones: d.milestones.filter((x) => x.id !== m.id) })); return true; },
    createSprint: async (v) => { commit((d) => ({ ...d, sprints: [...d.sprints, { id: nid(), ...v, notes: v.notes ?? "", version: 1, createdById: me.id, createdAt: now(), updatedAt: now(), updatedById: me.id }] })); return true; },
    updateSprint: async (s, p) => { commit((d) => ({ ...d, sprints: d.sprints.map((x) => (x.id === s.id ? { ...x, ...p } : x)) })); return true; },
    deleteSprint: async (s) => { commit((d) => ({ ...d, sprints: d.sprints.filter((x) => x.id !== s.id) })); return true; },
    undo: () => {
      const prev = history.current.pop();
      if (prev) { dataRef.current = prev; setDataState(prev); toast.show("info", "הפעולה בוטלה"); }
    },
    refresh: () => {},
  }), [data, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  return { store, dirty, setDirty };
}
