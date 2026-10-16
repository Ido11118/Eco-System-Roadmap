"use client";
// "תכולות שנמחקו": שחזור תכולה שנמחקה בטעות — עם אותו ID, כך שהשוואת תכנון מול ביצוע ממשיכה לזהות אותה
// (במקום ליצור אותה מחדש, מה שיוצר ID חדש ומופיע בהשוואה כ"נמחקה" + "נוספה").
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, RotateCcw } from "lucide-react";
import type { ItemDTO } from "@/lib/types";
import { api } from "@/lib/api";
import { weekNumber, weekYear } from "@/lib/weeks";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useCatalog } from "@/components/CatalogProvider";
import { PLAN_KEY } from "./store";
import { DELETED_RETENTION_DAYS } from "@/lib/constants";
import { fmtTs, placeLabel } from "./ui";
import type { PlanData } from "@/lib/types";

type Deleted = ItemDTO & { deletedAt: string; deletedBy: string; rowKind: string; canRestore: boolean };

export function DeletedItemsButton({ data }: { data: PlanData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-ghost btn-sm" onClick={() => setOpen(true)} data-testid="deleted-items" title="שחזור תכולות שנמחקו (עם אותו ID)">
        <ArchiveRestore size={14} />תכולות שנמחקו
      </button>
      {open && <DeletedItemsDialog data={data} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeletedItemsDialog({ data, onClose }: { data: PlanData; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cat = useCatalog();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["deleted-items"], queryFn: () => api<Deleted[]>("GET", "/api/items/deleted") });
  const items = (list.data ?? []).filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()) || String(i.id) === q.trim());
  const restore = async (it: Deleted) => {
    setBusy(it.id);
    try {
      const r = await api<ItemDTO>("POST", `/api/items/${it.id}/restore`);
      toast.show("success", r.rowId !== it.rowId ? `"${it.name}" שוחזרה (לשורה אחרת — המקורית נמחקה או תפוסה)` : `"${it.name}" שוחזרה`);
      await Promise.all([qc.invalidateQueries({ queryKey: PLAN_KEY }), qc.invalidateQueries({ queryKey: ["deleted-items"] })]);
    } catch (e) { toast.show("error", (e as Error).message); }
    setBusy(null);
  };
  return (
    <Dialog open onClose={onClose} width={640} title={<span className="flex items-center gap-2"><ArchiveRestore size={16} className="text-brand-600" />תכולות שנמחקו</span>}
      footer={<button className="btn-secondary" onClick={onClose}>סגירה</button>}>
      <p className="mb-2 text-[12.5px] text-ink-500">
        שחזור מחזיר את התכולה <b>עם אותו ID</b>, כך שבתכנון מול ביצוע היא ממשיכה להיות מזוהה. אם נמחקה בטעות — עדיף לשחזר אותה מאשר ליצור מחדש
        (יצירה מחדש מקבלת ID חדש ותופיע כ&quot;נמחקה&quot; + &quot;נוספה&quot;). מוצגות מחיקות מ-{DELETED_RETENTION_DAYS} הימים האחרונים, בתחומים שאתה מורשה לערוך.
      </p>
      <input className="input mb-2 h-8" placeholder="חיפוש לפי שם או ID…" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
      {list.isLoading && <div className="py-6 text-center text-ink-400">טוען…</div>}
      {list.data && items.length === 0 && <div className="py-6 text-center text-ink-400">אין תכולות שנמחקו{q ? " שמתאימות לחיפוש" : ""}.</div>}
      <ul className="divide-y divide-ink-100" data-testid="deleted-list">
        {items.map((it) => {
          const place = placeLabel(data, it);
          const st = cat.status(it.status);
          return (
            <li key={it.id} className="flex items-center gap-3 py-2" data-deleted={it.id}>
              <span className="h-3 w-3 shrink-0 rounded-sm border" style={{ background: st.bg, borderColor: st.border }} title={st.label} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink-900">{it.name} <span className="font-mono text-[11px] font-normal text-ink-400">ID {it.id}</span></div>
                <div className="truncate text-[11.5px] text-ink-500">
                  {place.domain}{place.team !== place.domain ? ` / ${place.team}` : ""} · שבועות {weekNumber(it.startWeek)}–{weekNumber(it.endWeek)} · {weekYear(it.startWeek)} · נמחקה {fmtTs(it.deletedAt)} ע״י {it.deletedBy}
                </div>
              </div>
              {it.canRestore ? (
                <button className="btn-secondary btn-sm" disabled={busy === it.id} onClick={() => void restore(it)} data-testid={`restore-item-${it.id}`}>
                  <RotateCcw size={13} />{busy === it.id ? "משחזר…" : "שחזור"}
                </button>
              ) : <span className="text-[11px] text-ink-400">אין הרשאה</span>}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
