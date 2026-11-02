"use client";
// אנליטיקות שימוש — ניהול מערכת (מנהל המערכת בלבד).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Info, Clock, ChevronDown, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { addDays, fmtDate, todayIL, weekNumber, HEB_MONTHS, isISODate } from "@/lib/weeks";
import { useTooltip } from "@/components/ui/tooltip";
import type { AnalyticsData, Granularity } from "@/server/analytics";

const PRESETS = [
  { key: "1", label: "היום", days: 1 },
  { key: "7", label: "7 ימים", days: 7 },
  { key: "30", label: "30 ימים", days: 30 },
  { key: "90", label: "רבעון", days: 90 },
  { key: "365", label: "שנה", days: 365 },
] as const;
const BAR = "#2563eb"; // סדרה אחת בכל גרף — גוון המותג

export function AnalyticsSettings() {
  const today = todayIL();
  const [preset, setPreset] = useState<string>("30");
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const range = preset === "custom" ? custom : { from: addDays(today, -(PRESETS.find((p) => p.key === preset)!.days - 1)), to: today };
  const valid = isISODate(range.from) && isISODate(range.to);
  const q = useQuery({
    queryKey: ["admin-analytics", range.from, range.to],
    queryFn: () => api<AnalyticsData>("GET", `/api/admin/analytics?from=${range.from}&to=${range.to}`),
    enabled: valid,
  });
  const d = q.data;
  return (
    <div className="space-y-4" data-testid="analytics">
      {/* בחירת תקופה — שורה אחת מעל הכל */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => setPreset(p.key)} data-testid={`range-${p.key}`}
            className={clsx("btn-sm rounded-md border px-3", preset === p.key ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50")}>{p.label}</button>
        ))}
        <button onClick={() => setPreset("custom")} className={clsx("btn-sm rounded-md border px-3", preset === "custom" ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50")}>טווח מותאם</button>
        {preset === "custom" && (
          <span className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
            <input type="date" className="input h-8 w-auto" value={custom.from} max={today} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            עד
            <input type="date" className="input h-8 w-auto" value={custom.to} max={today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </span>
        )}
        {d && <span className="mr-auto text-[12px] text-ink-400">{fmtDate(d.from)} – {fmtDate(d.to)}</span>}
      </div>

      {d?.trackingSince && d.from < d.trackingSince && (
        <div className="flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-[12.5px] text-ink-600">
          <Info size={14} className="mt-0.5 shrink-0" />
          נתוני כניסות וביקורים נאספים מ-{fmtDate(d.trackingSince)}. נתוני השינויים בתוכנית (מיומן הפעולות) זמינים לכל התקופה.
        </div>
      )}
      {!d?.trackingSince && d && (
        <div className="flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-[12.5px] text-ink-600">
          <Info size={14} className="mt-0.5 shrink-0" />איסוף נתוני הכניסות התחיל עכשיו — הנתונים יופיעו כאן בהמשך. נתוני השינויים בתוכנית זמינים כבר.
        </div>
      )}

      {q.isLoading || !d ? <div className="card p-10 text-center text-ink-500">טוען…</div> : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="analytics-kpis">
            <Kpi label="משתמשים פעילים" value={d.kpis.activeUsers} sub={`מתוך ${d.kpis.approvedUsers} מאושרים`} />
            <Kpi label="ממוצע משתמשים ביום" value={d.kpis.avgDailyActive} />
            <Kpi label="ביקורים" value={d.kpis.visits} sub={`${d.kpis.logins} התחברויות`} />
            <Kpi label="שינויים בתוכנית" value={d.kpis.changes} sub={`${d.kpis.itemsCreated} תכולות חדשות`} />
          </div>
          {d.kpis.aiUsers > 0 && (
            <div className="flex items-center gap-1.5 text-[12.5px] text-ink-500"><Sparkles size={13} className="text-fuchsia-600" />{d.kpis.aiUsers} משתמשים עבדו גם דרך Claude / כלי AI בתקופה הזו</div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <BarChart title={`משתמשים פעילים ${perLabel(d.granularity)}`} g={d.granularity} unit="משתמשים" testid="chart-active"
              data={d.series.map((s) => ({ bucket: s.bucket, value: s.activeUsers, extra: `${s.visits} ביקורים` }))} />
            <BarChart title={`שינויים בתוכנית ${perLabel(d.granularity)}`} g={d.granularity} unit="שינויים" testid="chart-changes"
              data={d.series.map((s) => ({ bucket: s.bucket, value: s.changes }))} />
          </div>

          <UsersTable rows={d.users} />

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="card p-4">
              <h3 className="mb-0.5 text-[14px] font-semibold">שינויים בתכולות לפי תחום</h3>
              <p className="mb-3 text-[12px] text-ink-500">אילו תחומים מתחזקים את התוכנית בתקופה הזו</p>
              <HBars rows={d.byDomain.map((x) => ({ label: x.name, value: x.changes }))} unit="שינויים" />
            </section>
            <section className="card p-4">
              <h3 className="mb-0.5 text-[14px] font-semibold">סוגי פעולות</h3>
              <p className="mb-3 text-[12px] text-ink-500">מה עשו במערכת בתקופה הזו</p>
              {d.changeTypes.length === 0 ? <div className="py-6 text-center text-[12.5px] text-ink-400">אין פעולות בתקופה</div> : (
                <table className="w-full text-[12.5px]"><tbody>
                  {d.changeTypes.map((t) => (
                    <tr key={t.key} className="border-t border-ink-100 first:border-0"><td className="py-1.5 text-ink-700">{t.label}</td><td className="py-1.5 text-left font-semibold tabular-nums text-ink-900">{t.count}</td></tr>
                  ))}
                </tbody></table>
              )}
            </section>
          </div>

          <TeamsFreshness rows={d.teams} />
        </>
      )}
    </div>
  );
}

const perLabel = (g: Granularity) => (g === "day" ? "לפי יום" : g === "week" ? "לפי שבוע" : "לפי חודש");
function bucketLabel(b: string, g: Granularity, short = false) {
  if (g === "day") return short ? `${b.slice(8, 10)}/${b.slice(5, 7)}` : fmtDate(b);
  if (g === "week") return short ? `ש׳ ${weekNumber(b)}` : `שבוע ${weekNumber(b)} (מ-${fmtDate(b)})`;
  return `${HEB_MONTHS[Number(b.slice(5, 7)) - 1]}${short ? "" : ` ${b.slice(0, 4)}`}`;
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12px] text-ink-500">{label}</div>
      <div className="mt-0.5 text-[26px] font-bold leading-tight tabular-nums text-ink-900">{value.toLocaleString("he-IL")}</div>
      {sub && <div className="text-[11.5px] text-ink-400">{sub}</div>}
    </div>
  );
}

/** עמודות לאורך זמן: סדרה אחת, ציר אחד. זמן זורם מימין לשמאל (כמו בגאנט). ריחוף על כל העמודה (לא רק על הבר) */
function BarChart({ title, data, g, unit, testid }: { title: string; data: { bucket: string; value: number; extra?: string }[]; g: Granularity; unit: string; testid: string }) {
  const tip = useTooltip();
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.map((x) => x.value));
  const step = niceStep(max), top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const H = 150, every = Math.max(1, Math.ceil(data.length / 8)); // עד ~8 תוויות בציר
  return (
    <section className="card p-4" data-testid={testid}>
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        <button className="btn-ghost btn-sm mr-auto text-[11.5px] text-ink-500" onClick={() => setTable((t) => !t)}>
          <ChevronDown size={12} className={clsx("transition", table && "rotate-180")} />{table ? "הסתרת הטבלה" : "הצגה כטבלה"}
        </button>
      </div>
      {/* ציר Y מימין (תחילת השורה ב-RTL), אחריו אזור העמודות; התוויות בציר X ממוקמות בדיוק מתחת לעמודה שלהן */}
      <div className="flex">
        <div className="relative w-7 shrink-0" style={{ height: H }}>
          {ticks.map((t) => <span key={t} className="absolute right-0 translate-y-1/2 text-[10.5px] tabular-nums text-ink-400" style={{ bottom: (t / top) * H }}>{t}</span>)}
        </div>
        <div className="relative flex-1" style={{ height: H }}>
          {ticks.map((t) => <div key={t} className="absolute inset-x-0 border-t border-ink-100" style={{ bottom: (t / top) * H }} />)}
          <div className="absolute inset-0 flex items-end gap-[2px] border-b border-ink-300">
            {data.map((x) => (
              <div key={x.bucket} className="group flex h-full min-w-0 flex-1 items-end justify-center"
                onMouseMove={(e) => tip.show(<div><div className="font-semibold">{bucketLabel(x.bucket, g)}</div><div>{x.value} {unit}{x.extra ? ` · ${x.extra}` : ""}</div></div>, e, { anchor: e.currentTarget })}
                onMouseLeave={tip.hide}>
                <div className="w-full max-w-[28px] rounded-t-[4px] transition-opacity group-hover:opacity-80" style={{ height: x.value ? Math.max(2, (x.value / top) * H) : 0, background: BAR }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex">
        <div className="w-7 shrink-0" />
        <div className="relative h-4 flex-1">
          {data.map((x, i) => i % every === 0 && (
            <span key={x.bucket} className="absolute top-0.5 translate-x-1/2 whitespace-nowrap text-[10.5px] text-ink-400" style={{ right: `${((i + 0.5) / data.length) * 100}%` }}>{bucketLabel(x.bucket, g, true)}</span>
          ))}
        </div>
      </div>
      {table && (
        <div className="mt-3 max-h-56 overflow-auto rounded-md border border-ink-200">
          <table className="w-full text-[12px]"><tbody>
            {data.map((x) => <tr key={x.bucket} className="border-t border-ink-100 first:border-0"><td className="px-2 py-1 text-ink-600">{bucketLabel(x.bucket, g)}</td><td className="px-2 py-1 text-left tabular-nums">{x.value}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </section>
  );
}
function niceStep(max: number) {
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
}

/** עמודות אופקיות (השוואה בין תחומים) — ממוינות, ערך בטקסט ליד כל עמודה */
function HBars({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const tip = useTooltip();
  const max = Math.max(1, ...rows.map((r) => r.value));
  const shown = rows.filter((r) => r.value > 0), idle = rows.length - shown.length;
  if (!shown.length) return <div className="py-6 text-center text-[12.5px] text-ink-400">אין שינויים בתקופה</div>;
  return (
    <div className="space-y-1.5">
      {shown.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12.5px]" onMouseMove={(e) => tip.show(`${r.label}: ${r.value} ${unit}`, e)} onMouseLeave={tip.hide}>
          <span className="w-24 shrink-0 truncate text-ink-700">{r.label}</span>
          <div className="h-3 flex-1"><div className="h-full rounded-l-[4px]" style={{ width: `${(r.value / max) * 100}%`, background: BAR, minWidth: r.value ? 2 : 0 }} /></div>
          <span className="w-8 shrink-0 text-left tabular-nums text-ink-700">{r.value}</span>
        </div>
      ))}
      {idle > 0 && <div className="pt-1 text-[11.5px] text-ink-400">ב-{idle} תחומים נוספים לא היו שינויים בתקופה</div>}
    </div>
  );
}

type URow = AnalyticsData["users"][number];
const U_COLS: { key: keyof URow; label: string }[] = [
  { key: "name", label: "משתמש" }, { key: "activeDays", label: "ימי פעילות" }, { key: "visits", label: "ביקורים" }, { key: "logins", label: "התחברויות" },
  { key: "changes", label: "שינויים" }, { key: "itemsCreated", label: "תכולות חדשות" }, { key: "aiDays", label: "ימים דרך AI" }, { key: "lastSeen", label: "נראה לאחרונה" },
];
function UsersTable({ rows }: { rows: URow[] }) {
  const [sort, setSort] = useState<{ key: keyof URow; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const x = a[sort.key] ?? "", y = b[sort.key] ?? "";
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "he")) * sort.dir;
    });
  }, [rows, sort]);
  const active = rows.filter((r) => r.activeDays > 0 || r.changes > 0).length;
  return (
    <section className="card overflow-hidden" data-testid="analytics-users">
      <div className="px-4 pb-2 pt-3">
        <h3 className="text-[14px] font-semibold">פילוח לפי משתמשים</h3>
        <p className="text-[12px] text-ink-500">{active} מתוך {rows.length} משתמשים מאושרים היו פעילים בתקופה · לחיצה על כותרת ממיינת</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead className="bg-ink-50 text-ink-500">
            <tr>{U_COLS.map((c) => (
              <th key={c.key} className="px-3 py-1.5 text-start font-medium">
                <button className="flex items-center gap-1 hover:text-ink-900" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === -1 ? 1 : -1 }))}>
                  {c.label}{sort?.key === c.key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button>
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {sorted.map((u) => {
              const idle = u.activeDays === 0 && u.changes === 0;
              return (
                <tr key={u.id} className={clsx("border-t border-ink-100", idle && "text-ink-400")} data-user-row={u.id}>
                  <td className="px-3 py-1.5 font-medium">{u.name}{u.role === "SUPER" && <span className="mr-1.5 rounded-full bg-brand-50 px-1.5 text-[10.5px] text-brand-700">מנהל</span>}{idle && <span className="mr-1.5 text-[11px]">· לא היה פעיל בתקופה</span>}</td>
                  <td className="px-3 py-1.5 tabular-nums">{u.activeDays}</td>
                  <td className="px-3 py-1.5 tabular-nums">{u.visits}</td>
                  <td className="px-3 py-1.5 tabular-nums">{u.logins}</td>
                  <td className="px-3 py-1.5 tabular-nums">{u.changes}</td>
                  <td className="px-3 py-1.5 tabular-nums">{u.itemsCreated}</td>
                  <td className="px-3 py-1.5 tabular-nums">{u.aiDays}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-ink-500">{u.lastSeen ? ago(u.lastSeen) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "היום" : days === 1 ? "אתמול" : `לפני ${days} ימים`;
}

/** עדכניות התוכנית לפי צוות — מצב נוכחי (לא תלוי בתקופה). צוותים שלא עודכנו הרבה זמן — ראשונים */
function TeamsFreshness({ rows }: { rows: AnalyticsData["teams"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <section className="card overflow-hidden" data-testid="analytics-teams">
      <div className="px-4 pb-2 pt-3">
        <h3 className="text-[14px] font-semibold">עדכניות התוכנית לפי צוות</h3>
        <p className="text-[12px] text-ink-500">מתי עודכנה לאחרונה תכולה של כל צוות (מצב נוכחי). צוותים שלא עודכנו מזמן — בראש הרשימה</p>
      </div>
      <table className="w-full text-[12.5px]">
        <thead className="bg-ink-50 text-ink-500"><tr>{["צוות", "תחום", "תכולות", "עדכון אחרון"].map((h) => <th key={h} className="px-3 py-1.5 text-start font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.id} className="border-t border-ink-100">
              <td className="px-3 py-1.5 font-medium text-ink-800">{t.name}</td>
              <td className="px-3 py-1.5 text-ink-500">{t.domain}</td>
              <td className="px-3 py-1.5 tabular-nums">{t.items}</td>
              <td className="px-3 py-1.5">
                {t.lastUpdate === null ? <span className="text-ink-400">אין תכולות</span> : (
                  <span className={clsx("flex items-center gap-1", (t.daysSince ?? 0) > 30 ? "font-medium text-amber-700" : "text-ink-600")}>
                    {(t.daysSince ?? 0) > 30 && <Clock size={12} />}{t.daysSince === 0 ? "היום" : `לפני ${t.daysSince} ימים`}{(t.daysSince ?? 0) > 30 && " · לא עודכן מעל חודש"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 8 && <button className="btn-ghost btn-sm m-2 text-brand-600" onClick={() => setAll((a) => !a)}>{all ? "הצגת פחות" : `הצגת כל ${rows.length} הצוותים`}</button>}
    </section>
  );
}
