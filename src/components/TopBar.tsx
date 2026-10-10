"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { CalendarRange, ChevronDown, LogOut, Users, Camera, GanttChart, ShieldCheck } from "lucide-react";
import type { Me } from "@/lib/types";
import { api } from "@/lib/api";
import { Floating, MenuItem } from "@/components/ui/popover";

export function TopBar({ me, active, children }: { me: Me; active: "plan" | "admin" | "snapshots"; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const initials = me.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto overflow-y-hidden border-b border-ink-200 bg-white px-4">
      <Link href="/plan" className="flex shrink-0 items-center gap-2 pl-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white"><CalendarRange size={16} /></span>
        <span className="hidden text-[14px] font-bold text-ink-900 sm:inline">תוכנית עבודה</span>
      </Link>
      <nav className="flex shrink-0 items-center gap-0.5 text-[13px]">
        {active !== "plan" && <Link href="/plan" className="btn-ghost btn-sm"><GanttChart size={14} />תוכנית</Link>}
        <Link href="/snapshots" className={active === "snapshots" ? "btn-ghost btn-sm bg-ink-100" : "btn-ghost btn-sm"}><Camera size={14} />תמונות מצב</Link>
        {me.role === "SUPER" && <Link href="/admin" className={active === "admin" ? "btn-ghost btn-sm bg-ink-100" : "btn-ghost btn-sm"} data-testid="nav-admin"><Users size={14} />ניהול משתמשים</Link>}
      </nav>
      <span className="h-5 w-px bg-ink-200" />
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
          <MenuItem icon={<LogOut size={14} />} onClick={async () => { await api("POST", "/api/auth/logout"); window.location.href = "/login"; }}>התנתקות</MenuItem>
        </div>
      </Floating>
    </header>
  );
}
