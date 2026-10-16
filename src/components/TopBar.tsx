"use client";
import { useRef, useState } from "react";
import { ChevronDown, LogOut, ShieldCheck, Settings } from "lucide-react";
import { UserSettingsDialog } from "./UserSettings";
import type { Me } from "@/lib/types";
import { api } from "@/lib/api";
import { Floating, MenuItem } from "@/components/ui/popover";

export function TopBar({ me, children }: { me: Me; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const initials = me.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto overflow-y-hidden border-b border-ink-200 bg-white px-4">
      <div className="flex flex-1 items-center gap-3 whitespace-nowrap">{children}</div>
      <button ref={btn} className="flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-ink-100" onClick={() => setOpen((o) => !o)} data-testid="user-menu">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-800 bg-gradient-to-br from-brand-500 to-brand-700 text-[11px] font-bold text-white">{initials}</span>
        <span className="hidden text-[12.5px] font-medium text-ink-700 xl:inline">{me.fullName}</span>
        <ChevronDown size={13} className="text-ink-400" />
      </button>
      <Floating anchor={btn.current} open={open} onClose={() => setOpen(false)} align="end">
        <div className="w-[260px] p-1.5">
          <div className="px-2.5 py-2">
            <div className="font-semibold text-ink-900">{me.fullName}</div>
            <div className="text-[12px] text-ink-500" dir="ltr" style={{ textAlign: "right" }}>{me.email}</div>
            <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-ink-500">
              <ShieldCheck size={12} />
              {me.role === "SUPER" ? "מנהל מערכת" : me.domainIds.length || me.canEditCross ? `עריכה: ${me.domainIds.length} תחומים${me.canEditCross ? " + רוחבי" : ""}` : "צפייה בלבד"}
            </div>
          </div>
          <div className="my-1 border-t border-ink-100" />
          <MenuItem icon={<Settings size={14} />} onClick={() => { setOpen(false); setSettings(true); }}>הגדרות</MenuItem>
          <MenuItem icon={<LogOut size={14} />} onClick={async () => { await api("POST", "/api/auth/logout"); window.location.href = "/login"; }}>התנתקות</MenuItem>
        </div>
      </Floating>
      {settings && <UserSettingsDialog me={me} onClose={() => setSettings(false)} />}
    </header>
  );
}
