"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ExternalLink, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/dialog";
import { MenuItem } from "@/components/ui/popover";
import { DELETED_RETENTION_DAYS } from "@/lib/constants";
import type { ItemDTO } from "@/lib/types";
import { useCatalog } from "@/components/CatalogProvider";
import type { PlanStore } from "./store";
import { PersonalGanttActions } from "./PersonalGanttActions";
import { useWorkspaceUI } from "./ui";

export function SelectionBar({ store }: { store: PlanStore }) {
  const ui = useWorkspaceUI();
  const cat = useCatalog();
  const [busy, setBusy] = useState(false);
  const items = store.data?.items.filter((i) => ui.selectedItems.has(i.id)) ?? [];
  if (!items.length) return null;
  const editable = items.every((i) => store.canEditRow(store.data?.rows.find((r) => r.id === i.rowId)));
  const apply = async (patch: { status?: string; priority?: string }) => {
    setBusy(true);
    try { await store.bulkUpdate(items, patch); } finally { setBusy(false); }
  };
  return <div className="flex shrink-0 items-center gap-2 border-b border-brand-200 bg-brand-50 px-4 py-1.5 text-[12px] text-brand-700" data-testid="bulk-bar" role="region" aria-label="פעולות על תכולות נבחרות"
    onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); store.undo(); } }}>
    <span className="font-medium" aria-live="polite">{items.length} נבחרו</span>
    {!ui.personalGantt && <>
    <select aria-label="שינוי סטטוס לבחירה" className="input h-7 w-auto py-0 text-[12px]" value="" disabled={!editable || busy} onChange={(e) => { if (e.target.value) void apply({ status: e.target.value }); }} data-testid="bulk-status">
      <option value="">שינוי סטטוס…</option>{cat.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
    <select aria-label="שינוי תיעדוף לבחירה" className="input h-7 w-auto py-0 text-[12px]" value="" disabled={!editable || busy} onChange={(e) => { if (e.target.value) void apply({ priority: e.target.value }); }} data-testid="bulk-priority">
      <option value="">שינוי תיעדוף…</option>{cat.priorities.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
    </select>
    </>}
    <PersonalGanttActions store={store} items={items} toolbar />
    <button className="btn-ghost btn-sm" onClick={() => ui.setSelectedItems(new Set())}>ניקוי בחירה</button>
    <span className="hidden text-[11px] text-ink-500 lg:inline">Ctrl / ⌘ + לחיצה לבחירה · קליק ימני לפעולות · Esc לניקוי</span>
  </div>;
}

/** תפריט קליק ימני על שורה (או על כמה שורות נבחרות): סטטוס, תיעדוף, פרטים, מחיקה */
export function ItemActionsMenu({ menu, store, onOpen, onDone, onDeleted }: {
  menu: { items: ItemDTO[]; one: { item: ItemDTO; editable: boolean } }; store: PlanStore; onOpen: (id: number) => void; onDone: () => void; onDeleted: () => void;
}) {
  const router = useRouter();
  const ui = useWorkspaceUI();
  const cat = useCatalog();
  const confirm = useConfirm();
  const { items, one } = menu;
  const multi = items.length > 1;
  const editable = items.every((i) => store.canEditRow(store.data?.rows.find((r) => r.id === i.rowId)));
  const apply = (patch: { status?: string; priority?: string }) => {
    onDone();
    if (multi) void store.bulkUpdate(items, patch);
    else void store.updateItem(items[0], patch);
  };
  return (
    <div className="w-[250px] p-1" data-testid="row-menu">
      <div className="truncate px-2.5 pb-1 pt-1 text-[11px] font-semibold text-ink-500">{multi ? `${items.length} תכולות נבחרו` : one.item.name}</div>
      {!multi && <MenuItem icon={<ExternalLink size={14} />} onClick={() => { onDone(); onOpen(one.item.id); }}>פתח פרטי תכולה</MenuItem>}
      {ui.personalGantt && !multi && <MenuItem icon={<ExternalLink size={14} />} onClick={() => { onDone(); router.push(`/plan?view=gantt&locate=${one.item.id}`); }}>פתח במקור לעריכה</MenuItem>}
      <PersonalGanttActions store={store} items={items} onDone={onDone} />
      {editable ? (
        <>
          <div className="my-1 border-t border-ink-100" />
          <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold text-ink-400">שינוי סטטוס</div>
          <div className="grid grid-cols-2 gap-0.5 px-1">
            {cat.statuses.map((st) => (
              <button key={st.key} onClick={() => apply({ status: st.key })} data-status-option={st.key}
                className={clsx("flex items-center gap-1.5 rounded px-1.5 py-1 text-start text-[12px] hover:bg-ink-100", !multi && one.item.status === st.key && "bg-ink-100 font-semibold")}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm border" style={{ background: st.bg, borderColor: st.border }} />
                <span className="truncate">{st.label}</span>
              </button>
            ))}
          </div>
          <div className="my-1 border-t border-ink-100" />
          <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold text-ink-400">שינוי תיעדוף</div>
          <div className="flex flex-wrap gap-0.5 px-1">
            {cat.priorities.map((p) => (
              <button key={p.key} onClick={() => apply({ priority: p.key })} data-priority-option={p.key}
                className={clsx("rounded px-2 py-1 text-[12px] font-medium hover:bg-ink-100", !multi && one.item.priority === p.key && "bg-ink-100")}
                style={{ color: p.key === cat.defaultPriority ? "#64748b" : p.color }}>{p.label}</button>
            ))}
          </div>
          <div className="my-1 border-t border-ink-100" />
          <MenuItem danger icon={<Trash2 size={14} />} onClick={async () => {
            onDone();
            const ok = await confirm({
              title: multi ? `מחיקת ${items.length} תכולות` : "מחיקת תכולה", danger: true, confirm: "מחיקה",
              text: <>
                {multi ? `האם אתה בטוח שברצונך למחוק ${items.length} תכולות?` : <>האם אתה בטוח שברצונך למחוק את &quot;{one.item.name}&quot;?</>}
                <span className="mt-1.5 block text-[12px] text-ink-500">אם תרצה לשחזר, התכולה תהיה זמינה ב-{DELETED_RETENTION_DAYS} הימים הקרובים תחת &quot;תכולות שנמחקו&quot; (עם אותו ID).</span>
              </>,
            });
            if (!ok) return;
            if (multi) { if (await store.deleteItems(items)) onDeleted(); }
            else { await store.deleteItem(items[0]); onDeleted(); }
          }}>{multi ? `מחיקת ${items.length} תכולות` : "מחיקת תכולה"}</MenuItem>
        </>
      ) : !ui.personalGantt && <div className="px-2.5 py-1.5 text-[12px] text-ink-400">אין לך הרשאת עריכה לתחום זה — צפייה בלבד</div>}
    </div>
  );
}
