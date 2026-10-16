"use client";
// מסגרת האפליקציה: סרגל צד (ניווט בין התצוגות) + אזור התוכן.
// סרגל הצד מחליף את כפתורי הניווט שהיו בסרגל העליון — כדי להפחית עומס במסך המרכזי.
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  CalendarRange, GanttChart, Table2, GitCompareArrows, Camera, ShieldCheck, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import type { Me } from "@/lib/types";
import { api } from "@/lib/api";
import { currentPrefs, savePrefs, useTextSize, zoomOf } from "@/components/plan/prefs";

export type NavKey = "gantt" | "table" | "compare" | "snapshots" | "admin";

export function AppShell({ me, active, children }: { me: Me; active: NavKey; children: React.ReactNode }) {
  // גודל תצוגה אישי: מגדיל/מקטין את כל הממשק (טקסט, שורות, כפתורים). height מתוקן כדי למלא בדיוק את המסך.
  const [size] = useTextSize(me.preferences);
  const z = zoomOf(size);
  return (
    <div className="flex w-full overflow-hidden" style={{ zoom: z, height: `calc(100vh / ${z})` }}>
      <Sidebar me={me} active={active} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

/** מספר בקשות ההרשמה הממתינות (למנהל המערכת בלבד) */
export function usePendingCount(enabled: boolean) {
  return useQuery({
    queryKey: ["pending-count"],
    queryFn: () => api<{ count: number }>("GET", "/api/admin/pending-count"),
    enabled,
    refetchInterval: 30000,
  });
}

function Sidebar({ me, active }: { me: Me; active: NavKey }) {
  const isSuper = me.role === "SUPER";
  const [collapsed, setCollapsed] = useState(() => !!currentPrefs(me.preferences).sidebarCollapsed);
  const pending = usePendingCount(isSuper).data?.count ?? 0;
  const toggle = () => { const v = !collapsed; setCollapsed(v); savePrefs({ sidebarCollapsed: v }); };

  const items: { key: NavKey; href: string; label: string; icon: React.ReactNode; badge?: number; testid: string }[] = [
    { key: "gantt", href: "/plan?view=gantt", label: "גאנט עדכני", icon: <GanttChart size={17} />, testid: "mode-gantt" },
    { key: "table", href: "/plan?view=table", label: "תכולות", icon: <Table2 size={17} />, testid: "mode-table" },
    { key: "compare", href: "/plan?view=compare", label: "תכנון מול ביצוע", icon: <GitCompareArrows size={17} />, testid: "mode-compare" },
    { key: "snapshots", href: "/snapshots", label: "תמונות מצב", icon: <Camera size={17} />, testid: "nav-snapshots" },
  ];
  if (isSuper) items.push({ key: "admin", href: "/admin", label: "ניהול מערכת", icon: <ShieldCheck size={17} />, badge: pending, testid: "nav-admin" });

  return (
    <aside className={clsx("flex shrink-0 flex-col border-l border-ink-200 bg-[#fbfcfe] transition-[width] duration-150", collapsed ? "w-[56px]" : "w-[196px]")}
      data-testid="sidebar">
      <Link href="/plan?view=gantt" className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-200 px-3" title="תוכנית עבודה">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white"><CalendarRange size={16} /></span>
        {!collapsed && <span className="truncate text-[14px] font-bold text-ink-900">תוכנית עבודה</span>}
      </Link>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {items.map((it) => {
          const on = it.key === active;
          return (
            <Link key={it.key} href={it.href} data-testid={it.testid} aria-current={on ? "page" : undefined}
              title={collapsed ? it.label : undefined}
              className={clsx("relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                on ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-100 hover:text-ink-900",
                it.key === "admin" && "mt-3")}>
              {on && <span className="absolute inset-y-1.5 right-0 w-[3px] rounded-l bg-brand-600" />}
              <span className="relative shrink-0">
                {it.icon}
                {!!it.badge && collapsed && <Badge n={it.badge} className="absolute -left-2 -top-1.5" />}
              </span>
              {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
              {!!it.badge && !collapsed && <Badge n={it.badge} />}
            </Link>
          );
        })}
      </nav>
      <button onClick={toggle} className="m-2 flex h-8 items-center gap-2 rounded-md px-2.5 text-[12px] text-ink-500 hover:bg-ink-100 hover:text-ink-900"
        title={collapsed ? "הרחבת סרגל הצד" : "כיווץ סרגל הצד"} aria-label={collapsed ? "הרחבת סרגל הצד" : "כיווץ סרגל הצד"}>
        {collapsed ? <PanelRightOpen size={16} /> : <><PanelRightClose size={16} /><span>כיווץ</span></>}
      </button>
    </aside>
  );
}

function Badge({ n, className }: { n: number; className?: string }) {
  return (
    <span className={clsx("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10.5px] font-bold leading-none text-white shadow-sm ring-2 ring-[#fbfcfe]", className)}
      data-testid="pending-badge" aria-label={`${n} בקשות ממתינות`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
