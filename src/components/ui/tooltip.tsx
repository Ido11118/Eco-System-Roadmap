"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Tooltip גלובלי אחד שעוקב אחרי העכבר — חסכוני גם בגאנט עם מאות קוביות
// delay: השהיה (מ"ש) לפני ההופעה — כדי שמעבר עכבר מהיר על פני הגאנט לא יקפיץ חלונות
type Ctx = { show: (content: React.ReactNode, e: { clientX: number; clientY: number }, opts?: { delay?: number }) => void; hide: () => void };
const TipCtx = createContext<Ctx | null>(null);

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  const [tip, setTip] = useState<{ content: React.ReactNode; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const visible = useRef(false);
  const pending = useRef<{ content: React.ReactNode; x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<Ctx["show"]>((content, e, opts) => {
    const next = { content, x: e.clientX, y: e.clientY };
    if (visible.current || !opts?.delay) { visible.current = true; setTip(next); return; }
    pending.current = next; // עדכון מיקום בזמן ההמתנה, בלי לאתחל את הטיימר
    if (!timer.current) timer.current = setTimeout(() => {
      timer.current = null;
      if (pending.current) { visible.current = true; setTip(pending.current); }
    }, opts.delay);
  }, []);
  const hide = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pending.current = null; visible.current = false;
    setTip(null);
  }, []);
  const value = useMemo(() => ({ show, hide }), [show, hide]); // ערך יציב — הצרכנים לא מתרנדרים בכל תזוזת עכבר
  useEffect(() => {
    window.addEventListener("scroll", hide, true);
    window.addEventListener("mousedown", hide, true);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("mousedown", hide, true); hide(); };
  }, [hide]);
  let left = 0, top = 0;
  if (tip) {
    const w = ref.current?.offsetWidth ?? 260, h = ref.current?.offsetHeight ?? 60;
    left = Math.min(Math.max(8, tip.x - w / 2), (typeof window !== "undefined" ? window.innerWidth : 1200) - w - 8);
    top = tip.y + 18;
    if (typeof window !== "undefined" && top + h > window.innerHeight - 8) top = tip.y - h - 12;
  }
  return (
    <TipCtx.Provider value={value}>
      {children}
      {tip && typeof document !== "undefined" && createPortal(
        <div ref={ref} className="pointer-events-none fixed z-[120] max-w-[340px] rounded-md bg-ink-900/95 px-2.5 py-1.5 text-[12px] leading-relaxed text-white shadow-pop"
          style={{ left, top }}>
          {tip.content}
        </div>, document.body)}
    </TipCtx.Provider>
  );
}

export function useTooltip() {
  const c = useContext(TipCtx);
  if (!c) throw new Error("TooltipProvider missing");
  return c;
}

/** עטיפה פשוטה לאלמנט עם Tooltip */
export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactElement<React.HTMLAttributes<HTMLElement>> }) {
  const t = useTooltip();
  return (
    <span className="contents"
      onMouseMove={(e) => t.show(content, e)} onMouseLeave={t.hide}>
      {children}
    </span>
  );
}
