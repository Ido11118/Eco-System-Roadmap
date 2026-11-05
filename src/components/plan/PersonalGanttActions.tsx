"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Minus } from "lucide-react";
import { api } from "@/lib/api";
import type { ItemDTO, Me } from "@/lib/types";
import { MenuItem } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { useWorkspaceUI } from "./ui";
import type { PlanStore } from "./store";

export function usePersonalGantt(me: Me, enabled = true) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["personal-gantt", me.id];
  const query = useQuery({ queryKey: key, queryFn: () => api<{ ids: number[] }>("GET", "/api/admin/personal-gantt"),
    enabled: enabled && me.role === "SUPER", refetchInterval: 10000 });
  const mutation = useMutation({
    mutationFn: (v: { action: "add" | "remove"; ids: number[] }) => api("POST", "/api/admin/personal-gantt", v),
    onSuccess: async (_, v) => {
      await qc.invalidateQueries({ queryKey: key });
      toast.show("success", v.action === "add" ? `נוספו ${v.ids.length} תכולות לגאנט שלי` : `הוסרו ${v.ids.length} תכולות מהגאנט שלי`);
    },
    onError: (e) => toast.show("error", e.message),
  });
  return { ...query, change: mutation.mutate, changing: mutation.isPending };
}

export function PersonalGanttActions({ store, items, onDone, toolbar = false }: {
  store: PlanStore; items: ItemDTO[]; onDone?: () => void; toolbar?: boolean;
}) {
  const { me } = useWorkspaceUI();
  const enabled = me.role === "SUPER" && store.kind === "live";
  const selection = usePersonalGantt(me, enabled);
  if (!enabled || !items.length) return null;
  const saved = new Set(selection.data?.ids ?? []);
  const missing = items.filter((i) => !saved.has(i.id));
  const present = items.filter((i) => saved.has(i.id));
  const disabled = !selection.data || selection.isError || selection.changing;
  const run = (action: "add" | "remove", list: ItemDTO[]) => { onDone?.(); selection.change({ action, ids: list.map((i) => i.id) }); };
  const button = (label: string, action: "add" | "remove", list: ItemDTO[]) => toolbar
    ? <button className="btn-secondary btn-sm" disabled={disabled} onClick={() => run(action, list)} data-testid={`personal-gantt-${action}`}>{label}</button>
    : <MenuItem icon={action === "add" ? <Plus size={14} /> : <Minus size={14} />} disabled={disabled} onClick={() => run(action, list)}>{label}</MenuItem>;
  return <div data-testid="personal-gantt-actions" className={toolbar ? "flex items-center gap-2" : "mt-1 border-t border-ink-100 pt-1"}>
    {!missing.length && !toolbar && <div className="flex items-center gap-1 px-2.5 py-1 text-[12px] text-brand-700"><Check size={13} />כבר בגאנט שלי</div>}
    {missing.length > 0 && button(items.length === 1 ? "הוספה לגאנט שלי" : `הוספת ${missing.length} תכולות לגאנט שלי`, "add", missing)}
    {present.length > 0 && button(items.length === 1 ? "הסרה מהגאנט שלי" : `הסרת ${present.length} תכולות מהגאנט שלי`, "remove", present)}
    {selection.isError && <span className="px-2 text-[11px] text-red-600">לא ניתן לטעון את הבחירה הפרטית</span>}
  </div>;
}
