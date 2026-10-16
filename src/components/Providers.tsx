"use client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { useState } from "react";
import { ToastProvider } from "./ui/toast";
import { ConfirmProvider } from "./ui/dialog";
import { TooltipProvider } from "./ui/tooltip";

// אחרי זמן ללא פעילות (עכבר/מקלדת) הלשונית נחשבת "לא בפוקוס": ה-polling נעצר, וכך השרת יכול להירדם
// (למשל מצב Serverless ב-Railway) גם כשלשונית נשארה פתוחה. עם חזרת הפעילות — רענון מיידי וה-polling חוזר.
const IDLE_MS = 15 * 60 * 1000;
if (typeof window !== "undefined") {
  focusManager.setEventListener((handleFocus) => {
    let idle = false;
    let timer: ReturnType<typeof setTimeout>;
    let armedAt = 0;
    const update = () => handleFocus(document.visibilityState === "visible" && !idle);
    const arm = () => {
      if (!idle && Date.now() - armedAt < 1000) return; // mousemove תכוף — לא מאתחלים טיימר בכל תזוזה
      armedAt = Date.now();
      clearTimeout(timer);
      timer = setTimeout(() => { idle = true; update(); }, IDLE_MS);
    };
    const onActivity = () => {
      arm();
      if (idle) { idle = false; update(); }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") onActivity(); else update(); };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5000 } },
  }));
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ConfirmProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
