"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X, Loader2 } from "lucide-react";
import clsx from "clsx";

type Kind = "success" | "error" | "info" | "loading";
type Toast = { id: number; kind: Kind; text: string; action?: { label: string; run: () => void }; ttl: number };
type Ctx = {
  show: (kind: Kind, text: string, opts?: { action?: Toast["action"]; ttl?: number }) => number;
  dismiss: (id: number) => void;
};
const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback<Ctx["show"]>((kind, text, opts) => {
    const id = seq.current++;
    const ttl = opts?.ttl ?? (kind === "error" ? 7000 : opts?.action ? 8000 : 2600);
    setToasts((t) => [...t.slice(-3), { id, kind, text, action: opts?.action, ttl }]);
    if (kind !== "loading") setTimeout(() => dismiss(id), ttl);
    return id;
  }, [dismiss]);
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 left-4 z-[100] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-32px)]" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status"
            className={clsx("anim-in flex items-start gap-2.5 rounded-lg border bg-white px-3 py-2.5 shadow-pop text-[13px]",
              t.kind === "error" ? "border-red-200" : "border-ink-200")}>
            <span className="mt-0.5 shrink-0">
              {t.kind === "success" && <CheckCircle2 size={16} className="text-green-600" />}
              {t.kind === "error" && <AlertTriangle size={16} className="text-red-600" />}
              {t.kind === "info" && <Info size={16} className="text-brand-600" />}
              {t.kind === "loading" && <Loader2 size={16} className="animate-spin text-ink-500" />}
            </span>
            <span className="flex-1 leading-snug text-ink-900">{t.text}</span>
            {t.action && (
              <button className="font-semibold text-brand-600 hover:underline shrink-0" onClick={() => { t.action!.run(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
            <button className="text-ink-400 hover:text-ink-700 shrink-0" onClick={() => dismiss(t.id)} aria-label="סגור"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("ToastProvider missing");
  return c;
}
