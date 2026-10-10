"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle } from "lucide-react";
import clsx from "clsx";

export function Dialog({
  open, onClose, title, children, footer, width = 480,
}: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null; // החזרת פוקוס בסגירה
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=checkbox]), textarea, select");
      el?.focus();
    }, 20);
    return () => { window.removeEventListener("keydown", onKey, true); clearTimeout(t); prevFocus?.focus?.(); };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-ink-900/30 pt-[10vh] px-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" className="anim-in card shadow-pop w-full max-h-[80vh] flex flex-col" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגור"><X size={16} /></button>
        </div>
        <div className="px-5 pb-4 overflow-auto">{children}</div>
        {footer && <div className="flex items-center justify-start gap-2 border-t border-ink-100 px-5 py-3 bg-ink-50/60 rounded-b-xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

type ConfirmOpts = { title: string; text: React.ReactNode; confirm: string; cancel?: string; danger?: boolean };
const ConfirmCtx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog open={!!state} onClose={() => close(false)} width={440}
        title={<span className="flex items-center gap-2">{state?.danger && <AlertTriangle size={18} className="text-amber-500" />}{state?.title}</span>}
        footer={<>
          <button className={clsx(state?.danger ? "btn-danger" : "btn-primary")} onClick={() => close(true)} data-autofocus>{state?.confirm}</button>
          <button className="btn-secondary" onClick={() => close(false)}>{state?.cancel ?? "ביטול"}</button>
        </>}>
        <div className="text-[13px] leading-relaxed text-ink-700">{state?.text}</div>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(ConfirmCtx);
  if (!c) throw new Error("ConfirmProvider missing");
  return c;
}
