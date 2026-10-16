"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Tooltip גלובלי אחד שעוקב אחרי העכבר — חסכוני גם בגאנט עם מאות קוביות
// delay: השהיה (מ"ש) לפני ההופעה — כדי שמעבר עכבר מהיר על פני הגאנט לא יקפיץ חלונות
// anchor: אלמנט קטן (אבן דרך, לשונית ספרינט) — ה-Tooltip נצמד אליו ולא לסמן העכבר
// placement: "top" — מעל האלמנט (למשל כפתורי אייקון בשורת הסינון); ברירת מחדל — מתחת
type ShowOpts = { delay?: number; anchor?: Element | null; placement?: "top" | "bottom" };
type Ctx = { show: (content: React.ReactNode, e: { clientX: number; clientY: number }, opts?: ShowOpts) => void; hide: () => void };
const TipCtx = createContext<Ctx | null>(null);
type TipState = { content: React.ReactNode; x: number; y: number; rect?: { left: number; right: number; top: number; bottom: number }; top?: boolean };

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const visible = useRef(false);
  const pending = useRef<TipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<Ctx["show"]>((content, e, opts) => {
    const r = opts?.anchor?.getBoundingClientRect();
    const next: TipState = { content, x: e.clientX, y: e.clientY, rect: r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : undefined, top: opts?.placement === "top" };
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
    setTip(null); setPos(null);
  }, []);
  const value = useMemo(() => ({ show, hide }), [show, hide]); // ערך יציב — הצרכנים לא מתרנדרים בכל תזוזת עכבר
  useEffect(() => {
    window.addEventListener("scroll", hide, true);
    window.addEventListener("mousedown", hide, true);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("mousedown", hide, true); hide(); };
  }, [hide]);
  // המיקום מחושב אחרי מדידת הגודל האמיתי של ה-Tooltip ולפני הציור — כך הוא תמיד צמוד ומרוכז
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    const cx = tip.rect ? (tip.rect.left + tip.rect.right) / 2 : tip.x;
    const below = tip.rect ? tip.rect.bottom + 6 : tip.y + 18;
    const above = tip.rect ? tip.rect.top - h - 6 : tip.y - h - 12;
    const left = Math.min(Math.max(8, cx - w / 2), window.innerWidth - w - 8);
    const top = tip.top
      ? (above >= 8 ? above : below) // מעל, ואם אין מקום — מתחת
      : below + h > window.innerHeight - 8 ? Math.max(8, above) : below;
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [tip]);
  return (
    <TipCtx.Provider value={value}>
      {children}
      {tip && typeof document !== "undefined" && createPortal(
        <div ref={ref} className="pointer-events-none fixed z-[120] max-w-[340px] rounded-md bg-ink-900/95 px-2.5 py-1.5 text-[12px] leading-relaxed text-white shadow-pop"
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }} data-testid="tooltip">
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
