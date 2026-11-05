"use client";
import { useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ItemDTO, Me, RowDTO } from "@/lib/types";
import { PRIVATE_TEAM, type PrivateCommand, type PrivatePlan } from "@/lib/privateWorkspace";
import { shiftedEntries } from "@/lib/itemBatch";
import { useToast } from "@/components/ui/toast";
import type { ItemPatch, PlanStore } from "./store";

const endpoint = "/api/admin/personal-gantt/workspace";
type Response = { plan: PrivatePlan; result: { items?: ItemDTO[]; row?: RowDTO } };
type Undo = { label: string; run: () => Promise<unknown> };

export function usePrivateWorkspace(me: Me) {
  const qc = useQueryClient();
  const toast = useToast();
  const pending = useRef(0);
  const key = useMemo(() => ["private-workspace", me.id], [me.id]);
  const q = useQuery({ queryKey: key, queryFn: () => api<PrivatePlan>("GET", endpoint), enabled: me.role === "SUPER",
    refetchInterval: () => pending.current ? false : 10000,
    structuralSharing: (old, next) => (old as PrivatePlan | undefined)?.version! > (next as PrivatePlan).version ? old : next });
  const dataRef = useRef(q.data); dataRef.current = q.data;
  const history = useRef<Undo[]>([]);
  const fail = useCallback((e: unknown) => { toast.show("error", (e as Error).message); void qc.invalidateQueries({ queryKey: key }); }, [qc, key, toast]);
  const send = useCallback(async (command: PrivateCommand) => {
    pending.current++;
    try {
      await qc.cancelQueries({ queryKey: key });
      const r = await api<Response>("POST", endpoint, command);
      if (!dataRef.current || dataRef.current.version <= r.plan.version) dataRef.current = r.plan;
      qc.setQueryData<PrivatePlan>(key, (old) => old && old.version > r.plan.version ? old : r.plan);
      return r.result;
    } finally { pending.current--; }
  }, [qc, key]);
  const runUndo = useCallback(async (op: Undo) => {
    if (!history.current.includes(op)) return;
    history.current = history.current.filter((o) => o !== op);
    try { await op.run(); toast.show("info", `בוטל: ${op.label}`); } catch (e) { fail(e); }
  }, [fail, toast]);
  const push = useCallback((op: Undo, silent = false) => {
    history.current.push(op); if (history.current.length > 30) history.current.shift();
    if (!silent) toast.show("success", op.label, { action: { label: "ביטול", run: () => { void runUndo(op); } } });
  }, [runUndo, toast]);
  const change = useCallback(async (items: ItemDTO[], entries: { id: number; version: number; patch: ItemPatch }[], label: string, opts?: { noUndo?: boolean; silent?: boolean }) => {
    try {
      const r = await send({ action: "update", entries });
      if (!opts?.noUndo) push({ label, run: () => {
        const reverse = entries.map((e) => {
          const before = items.find((i) => i.id === e.id)!;
          const expected = r.items!.find((i) => i.id === e.id)!;
          const current = dataRef.current?.items.find((i) => i.id === e.id);
          const keys = Object.keys(e.patch) as (keyof ItemPatch)[];
          if (!current || keys.some((k) => JSON.stringify(current[k]) !== JSON.stringify(expected[k]))) throw new Error("התכולה השתנתה מאז הפעולה — הביטול נעצר");
          return { id: e.id, version: current.version, patch: Object.fromEntries(keys.map((k) => [k, before[k]])) };
        });
        return send({ action: "update", entries: reverse });
      } }, opts?.silent);
      return true;
    } catch (e) { fail(e); return false; }
  }, [send, push, fail]);
  const deleteItems = useCallback(async (items: ItemDTO[]) => {
    try {
      const deleted = await send({ action: "delete", entries: items.map((i) => ({ id: i.id, version: i.version })) });
      push({ label: `נמחקו ${items.length} תכולות פרטיות`, run: () => send({ action: "restore", entries: deleted.items!.map((i) => ({ id: i.id, version: i.version })) }) });
      return true;
    } catch (e) { fail(e); return false; }
  }, [send, push, fail]);
  const restoreItems = useCallback(async (items: ItemDTO[]) => {
    try { await send({ action: "restore", entries: items.map((i) => ({ id: i.id, version: i.version })) }); return true; }
    catch (e) { fail(e); return false; }
  }, [send, fail]);
  const controls = useMemo<Pick<PlanStore, "createItem" | "updateItem" | "bulkUpdate" | "shiftItems" | "deleteItem" | "deleteItems" | "createRow" | "deleteRow" | "undo">>(() => ({
    createItem: async (item) => {
      try {
        const r = await send({ action: "create", item });
        const created = r.items![0];
        push({ label: `נוספה תכולה פרטית "${created.name}"`, run: () => {
          const current = dataRef.current?.items.find((i) => i.id === created.id);
          const fields: (keyof ItemDTO)[] = ["name", "notes", "status", "priority", "dependencies", "rowId", "startWeek", "endWeek"];
          if (!current || fields.some((k) => JSON.stringify(current[k]) !== JSON.stringify(created[k]))) throw new Error("התכולה הפרטית השתנתה — הביטול נעצר");
          return send({ action: "delete", entries: [{ id: current.id, version: current.version }] });
        } });
        return created;
      } catch (e) { fail(e); return null; }
    },
    updateItem: (item, patch, opts) => change([item], [{ id: item.id, version: item.version, patch }], opts?.undoLabel ?? `התכולה הפרטית "${item.name}" עודכנה`, opts),
    bulkUpdate: (items, patch) => change(items, items.map((i) => ({ id: i.id, version: i.version, patch })), `עודכנו ${items.length} תכולות פרטיות`),
    shiftItems: (items, weeks) => change(items, shiftedEntries(items, weeks).map((e) => ({ ...e, patch: e.patch! })), `הוזזו ${items.length} תכולות פרטיות`),
    deleteItems,
    deleteItem: async (item) => { await deleteItems([item]); },
    createRow: async (teamId, anchorRowId, position) => {
      try {
        if (teamId !== PRIVATE_TEAM) throw new Error("אפשר להוסיף שורות רק בגאנט עמר");
        const r = await send({ action: "createRow", anchorRowId, position });
        const row = r.row!;
        push({ label: "נוספה שורה בגאנט עמר", run: () => {
          if (dataRef.current?.items.some((i) => i.rowId === row.id)) throw new Error("השורה מכילה תכולות — לא ניתן לבטל את הוספתה");
          return send({ action: "deleteRow", id: row.id, version: row.version });
        } }, true);
        return row.id;
      } catch (e) { fail(e); return null; }
    },
    deleteRow: async (row, opts) => {
      try {
        const r = await send({ action: "deleteRow", id: row.id, version: row.version });
        if (!opts?.silent) push({ label: "נמחקה שורה פרטית", run: () => send({ action: "restoreRow", id: r.row!.id, version: r.row!.version }) });
      } catch (e) { fail(e); }
    },
    undo: () => { const op = history.current.at(-1); if (op) void runUndo(op); else toast.show("info", "אין פעולה פרטית לביטול"); },
  }), [send, change, push, deleteItems, fail, runUndo, toast]);
  return { ...q, controls, restoreItems };
}
