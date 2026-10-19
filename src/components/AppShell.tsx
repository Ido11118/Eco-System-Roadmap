"use client";
// מסגרת האפליקציה: סרגל צד (ניווט בין התצוגות) + אזור התוכן.
// סרגל הצד מחליף את כפתורי הניווט שהיו בסרגל העליון — כדי להפחית עומס במסך המרכזי.
import Link from "next/link";
import { createContext, useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  CalendarRange, GanttChart, Table2, ListTodo, GitCompareArrows, Camera, ShieldCheck, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import type { Me } from "@/lib/types";
import { api } from "@/lib/api";
import { useIsMobile } from "@/components/ui/useMobile";
import { currentPrefs, savePrefs, useTextSize, zoomOf } from "@/components/plan/prefs";

export type NavKey = "gantt" | "table" | "backlog" | "compare" | "snapshots" | "admin";

/** sidebarAction: כפתור פעולה בתחתית סרגל הצד (למשל "הוספה בעזרת AI" בדף התוכנית) */
export function AppShell({ me, active, children, sidebarAction }: { me: Me; active: NavKey; children: React.ReactNode; sidebarAction?: React.ReactNode }) {
  // גודל תצוגה אישי: מגדיל/מקטין את כל הממשק (טקסט, שורות, כפתורים). height מתוקן כדי למלא בדיוק את המסך.
  const [size] = useTextSize(me.preferences);
  const z = zoomOf(size);
  // טלפון: סרגל הצד מוסתר ונפתח כמגירה מכפתור ☰ בסרגל העליון (dvh — גובה המסך בפועל, בלי שורת הכתובת)
  const mobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);
  return (
    <MobileNavCtx.Provider value={mobile ? () => setNavOpen(true) : null}>
      <div className="flex w-full overflow-hidden" style={{ zoom: z, height: `calc(${mobile ? "100dvh" : "100vh"} / ${z})` }}>
        {!mobile && <Sidebar me={me} active={active} action={sidebarAction} />}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
      {/* המגירה נשארת טעונה גם כשהיא סגורה (רק מוסתרת) — כך חלון שנפתח ממנה (למשל ייבוא AI) לא נסגר איתה */}
      {mobile && (
        <div className={clsx("fixed inset-0 z-[85] bg-ink-900/30", !navOpen && "hidden")} style={{ zoom: z }} onMouseDown={(e) => { if (e.target === e.currentTarget) setNavOpen(false); }} data-testid={navOpen ? "mobile-nav" : undefined}>
          <div className="anim-in absolute inset-y-0 right-0 flex shadow-pop">
            <Sidebar me={me} active={active} action={sidebarAction} mobile onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}
    </MobileNavCtx.Provider>
  );
}

/** פתיחת תפריט הניווט בטלפון (null במחשב — שם סרגל הצד תמיד מוצג) */
const MobileNavCtx = createContext<(() => void) | null>(null);
export const useMobileNav = () => useContext(MobileNavCtx);

/** מספר בקשות ההרשמה הממתינות (למנהל המערכת בלבד) */
export function usePendingCount(enabled: boolean) {
  return useQuery({
    queryKey: ["pending-count"],
    queryFn: () => api<{ count: number }>("GET", "/api/admin/pending-count"),
    enabled,
    refetchInterval: 30000,
  });
}

function Sidebar({ me, active, action, mobile, onNavigate }: { me: Me; active: NavKey; action?: React.ReactNode; mobile?: boolean; onNavigate?: () => void }) {
  const isSuper = me.role === "SUPER";
  const [collapsedPref, setCollapsed] = useState(() => !!currentPrefs(me.preferences).sidebarCollapsed);
  const collapsed = mobile ? false : collapsedPref; // במגירה בטלפון — תמיד פתוח
  const pending = usePendingCount(isSuper).data?.count ?? 0;
  const toggle = () => { const v = !collapsedPref; setCollapsed(v); savePrefs({ sidebarCollapsed: v }); };

  const items: { key: NavKey; href: string; label: string; icon: React.ReactNode; badge?: number; testid: string }[] = [
    { key: "gantt", href: "/plan?view=gantt", label: "גאנט עדכני", icon: <GanttChart size={17} />, testid: "mode-gantt" },
    { key: "table", href: "/plan?view=table", label: "תכולות", icon: <Table2 size={17} />, testid: "mode-table" },
    // באקלוג: רק למי שעורך תחום (הרשימה משותפת עם עורכי התחום בלבד)
    ...(isSuper || me.domainIds.length > 0 ? [{ key: "backlog" as const, href: "/plan?view=backlog", label: "באקלוג אישי", icon: <ListTodo size={17} />, testid: "mode-backlog" }] : []),
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
            <Link key={it.key} href={it.href} data-testid={it.testid} aria-current={on ? "page" : undefined} onClick={onNavigate}
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
      {/* כפתור פעולה: צמוד לימין באותו מיקום בדיוק בסרגל פתוח ומכווץ (נכנס ב-56px בלי לחרוג מהשוליים) */}
      {action && (
        // בטלפון: הקשה על כפתור הפעולה סוגרת את המגירה (רק הקשות בתוך המגירה עצמה — לא בתוך החלון שנפתח ממנה)
        <div className="flex justify-start px-2 pb-1" data-testid="sidebar-action"
          onClick={mobile ? (e) => { if (e.currentTarget.contains(e.target as Node)) onNavigate?.(); } : undefined}>{action}</div>
      )}
      {!mobile && <button onClick={toggle} className="m-2 flex h-8 items-center gap-2 rounded-md px-2.5 text-[12px] text-ink-500 hover:bg-ink-100 hover:text-ink-900"
        title={collapsed ? "הרחבת סרגל הצד" : "כיווץ סרגל הצד"} aria-label={collapsed ? "הרחבת סרגל הצד" : "כיווץ סרגל הצד"}>
        {collapsed ? <PanelRightOpen size={16} /> : <><PanelRightClose size={16} /><span>כיווץ</span></>}
      </button>}
      {mobile && <div className="h-3 shrink-0" />}
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
