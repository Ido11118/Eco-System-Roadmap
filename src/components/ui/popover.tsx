"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import clsx from "clsx";

/** פופאובר צף המוצמד לאלמנט עוגן או לנקודה */
export function Floating({
  anchor, point, open, onClose, children, align = "start", className,
}: {
  anchor?: HTMLElement | null; point?: { x: number; y: number }; open: boolean; onClose: () => void;
  children: React.ReactNode; align?: "start" | "end"; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 240, h = el?.offsetHeight ?? 200;
    let top: number, left: number;
    if (point) { top = point.y + 4; left = point.x - w; if (left < 8) left = point.x; }
    else if (anchor) {
      const r = anchor.getBoundingClientRect();
      top = r.bottom + 4;
      left = align === "start" ? r.right - w : r.left; // RTL: יישור לימין העוגן
    } else { top = 100; left = 100; }
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (top + h > window.innerHeight - 8) top = Math.max(8, (point?.y ?? anchor?.getBoundingClientRect().top ?? 0) - h - 4);
    setPos({ top, left });
  }, [open, anchor, point?.x, point?.y, align]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    // גלילה סוגרת פופאובר מעוגן (כדי שלא "ינתק" מהתא שלו); מתעלמים מגלילות שהתרחשו ממש בעת הפתיחה
    const t2 = setTimeout(() => window.addEventListener("scroll", onScroll, true), 300);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t); clearTimeout(t2);
      window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, onClose, anchor]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} className={clsx("fixed z-[90] anim-in rounded-lg border border-ink-200 bg-white shadow-pop", className)}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon, children, onClick, danger, disabled, hint }: {
  icon?: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string;
}) {
  return (
    <button disabled={disabled} onClick={onClick} role="menuitem"
      className={clsx("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-[13px] disabled:opacity-40",
        danger ? "text-red-600 hover:bg-red-50" : "text-ink-700 hover:bg-ink-100")}>
      <span className="w-4 shrink-0 text-ink-400">{icon}</span>
      <span className="flex-1">{children}</span>
      {hint && <span className="kbd">{hint}</span>}
    </button>
  );
}

/** בחירה מרובה עם חיפוש */
export function MultiSelect<T extends string | number>({
  label, options, value, onChange, allLabel = "הכל", renderOption, width = 220, groups,
}: {
  label: string;
  options: { value: T; label: string; group?: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  allLabel?: string;
  renderOption?: (o: { value: T; label: string }) => React.ReactNode;
  width?: number;
  groups?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const filtered = options.filter((o) => !q || o.label.includes(q) || (o.group ?? "").includes(q));
  const summary = value.length === 0 ? allLabel
    : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? "1"
    : `${value.length} נבחרו`;
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  let lastGroup: string | undefined;
  return (
    <>
      <button ref={btn} onClick={() => setOpen((o) => !o)}
        className={clsx("btn-secondary btn-sm gap-1 font-normal", value.length > 0 && "border-brand-500 bg-brand-50 text-brand-700")}>
        <span className="text-ink-500">{label}:</span>
        <span className="max-w-[120px] truncate font-medium">{summary}</span>
        <ChevronDown size={13} className="text-ink-400" />
      </button>
      <Floating anchor={btn.current} open={open} onClose={() => setOpen(false)}>
        <div style={{ width }} className="p-1.5">
          {options.length > 8 && (
            <input className="input mb-1.5 h-7" placeholder="חיפוש…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          <div className="flex items-center justify-between px-1 pb-1 text-[12px]">
            <button className="text-brand-600 hover:underline" onClick={() => onChange([])}>{allLabel}</button>
            {value.length > 0 && <span className="text-ink-400">{value.length} נבחרו</span>}
          </div>
          <div className="max-h-[320px] overflow-auto">
            {filtered.map((o) => {
              const header = groups && o.group !== lastGroup ? o.group : undefined;
              lastGroup = o.group;
              return (
                <div key={String(o.value)}>
                  {header && <div className="px-2 pt-2 pb-0.5 text-[11px] font-semibold text-ink-400">{header}</div>}
                  <button onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-start text-[13px] hover:bg-ink-100">
                    <span className={clsx("flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      value.includes(o.value) ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300 bg-white")}>
                      {value.includes(o.value) && <Check size={11} strokeWidth={3} />}
                    </span>
                    {renderOption ? renderOption(o) : <span className="truncate">{o.label}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </Floating>
    </>
  );
}
