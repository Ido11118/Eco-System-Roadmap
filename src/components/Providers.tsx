"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ToastProvider } from "./ui/toast";
import { ConfirmProvider } from "./ui/dialog";
import { TooltipProvider } from "./ui/tooltip";

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
