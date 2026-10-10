"use client";
import { api } from "@/lib/api";
export function PendingActions() {
  return (
    <div className="mt-6 flex gap-2">
      <button className="btn-primary flex-1" onClick={() => window.location.reload()}>בדוק שוב</button>
      <button className="btn-secondary flex-1" onClick={async () => { await api("POST", "/api/auth/logout"); window.location.href = "/login"; }}>התנתקות</button>
    </div>
  );
}
