"use client";
// תלויות של תכולה: עריכה בחלונית הפרטים, סימון בקובייה בגאנט ועמודה בטבלה.
// תלות "פתוחה" (לא סומנה כטופלה) מסומנת בכתום — משהו שמנהל המוצר צריך להתעסק איתו.
import { useState } from "react";
import clsx from "clsx";
import { Link2, Plus, X, CheckCircle2 } from "lucide-react";
import type { Dependency, ItemDTO, PlanData } from "@/lib/types";
import { depsOf, newDepId, openDeps } from "@/lib/deps";

/** רשימת התלויות בחלונית התכולה: סימון "טופלה", הסרה והוספה (שם + מול מי) */
export function DependenciesEditor({ item, data, editable, onChange }: {
  item: ItemDTO; data: PlanData; editable: boolean; onChange: (deps: Dependency[]) => void;
}) {
  const deps = depsOf(item);
  const [text, setText] = useState("");
  const [on, setOn] = useState("");
  const open = deps.filter((d) => !d.done).length;
  const add = () => {
    if (!text.trim()) return;
    onChange([...deps, { id: newDepId(), text: text.trim(), on: on.trim(), done: false }]);
    setText(""); setOn("");
  };
  // הצעות ל"מול מי": צוותים ותחומים קיימים (אפשר גם להקליד גורם חיצוני)
  const suggestions = [...new Set([...data.domains.map((d) => d.name), ...data.teams.map((t) => t.name)])];
  return (
    <div data-testid="deps-editor">
      <div className="label flex items-center gap-1.5">
        <Link2 size={13} />תלויות
        {open > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{open} פתוחות</span>}
      </div>
      {deps.length === 0 && !editable && <div className="text-[12.5px] text-ink-400">אין תלויות</div>}
      {deps.length > 0 && (
        <ul className="mb-2 divide-y divide-ink-100 rounded-md border border-ink-200">
          {deps.map((d) => (
            <li key={d.id} className={clsx("flex items-start gap-2 px-2.5 py-1.5", !d.done && "bg-amber-50/60")} data-dep={d.id}>
              <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-green-600" checked={d.done} disabled={!editable}
                onChange={(e) => onChange(deps.map((x) => (x.id === d.id ? { ...x, done: e.target.checked } : x)))}
                title={d.done ? "סמן כפתוחה" : "סמן כטופלה"} aria-label={`טופלה: ${d.text}`} data-testid={`dep-done-${d.id}`} />
              <div className="min-w-0 flex-1">
                <div className={clsx("text-[13px] leading-snug", d.done ? "text-ink-400 line-through" : "text-ink-900")}>{d.text}</div>
                {d.on && <div className="text-[11.5px] text-ink-500">מול: {d.on}</div>}
              </div>
              {editable && (
                <button className="icon-btn h-6 w-6 shrink-0 text-ink-400 hover:text-red-600" onClick={() => onChange(deps.filter((x) => x.id !== d.id))}
                  aria-label={`הסרת התלות ${d.text}`} title="הסרה"><X size={13} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="flex gap-1.5">
          <input className="input h-8 flex-[3] text-[12.5px]" placeholder="תלות חדשה — למשל: API מצוות ניטור" value={text} maxLength={300}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} data-testid="dep-text" />
          <input className="input h-8 flex-[2] text-[12.5px]" placeholder="מול מי?" value={on} maxLength={80} list={`dep-on-${item.id}`}
            onChange={(e) => setOn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} data-testid="dep-on" />
          <datalist id={`dep-on-${item.id}`}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          <button className="btn-secondary btn-sm h-8 shrink-0" disabled={!text.trim()} onClick={add} data-testid="dep-add"><Plus size={13} />הוספה</button>
        </div>
      )}
    </div>
  );
}

/** סימון בקובייה בגאנט: מספר התלויות הפתוחות */
export function DepBadge({ item }: { item: ItemDTO }) {
  const n = openDeps(item).length;
  if (!n) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5 rounded-sm bg-amber-400 px-1 text-[10px] font-bold leading-[14px] text-amber-950" data-dep-badge={n}>
      <Link2 size={10} strokeWidth={2.5} />{n}
    </span>
  );
}

/** פירוט התלויות הפתוחות (לטולטיפ ולסיכום) */
export function DepList({ item, max = 4 }: { item: ItemDTO; max?: number }) {
  const open = openDeps(item);
  if (!open.length) return null;
  return (
    <div className="mt-1 rounded bg-amber-400/20 px-1.5 py-1">
      <div className="flex items-center gap-1 font-semibold"><Link2 size={11} />תלויות פתוחות ({open.length})</div>
      {open.slice(0, max).map((d) => <div key={d.id} className="max-w-[280px] truncate">• {d.text}{d.on ? ` (מול ${d.on})` : ""}</div>)}
      {open.length > max && <div className="opacity-70">ועוד {open.length - max}…</div>}
    </div>
  );
}

/** תא בטבלת התכולות: תלויות פתוחות בכתום, או "הכל טופל" בירוק. לחיצה פותחת את הפרטים לעריכה */
export function DepsCell({ item, editable, onOpen }: { item: ItemDTO; editable: boolean; onOpen: () => void }) {
  const all = depsOf(item);
  const open = all.filter((d) => !d.done);
  const title = all.map((d) => `${d.done ? "✓" : "•"} ${d.text}${d.on ? ` (מול ${d.on})` : ""}`).join("\n");
  return (
    <button className={clsx("flex w-full min-w-0 items-center gap-1.5 rounded px-1 -mx-1 py-0.5 text-start hover:bg-ink-100", !all.length && "text-ink-300")}
      onClick={onOpen} title={title || (editable ? "הוספת תלות" : "")} data-testid={`deps-${item.id}`}>
      {open.length > 0 ? (
        <>
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800"><Link2 size={11} />{open.length}</span>
          <span className="truncate text-ink-800">{open[0].text}{open[0].on ? <span className="text-ink-400"> · {open[0].on}</span> : null}</span>
        </>
      ) : all.length > 0 ? (
        <span className="flex items-center gap-1 text-[12px] text-green-700"><CheckCircle2 size={12} />{all.length === 1 ? "טופלה" : `${all.length} טופלו`}</span>
      ) : (editable ? "הוסף תלות…" : "—")}
    </button>
  );
}
