"use client";
// מבנה הגאנט: תחומים קבועים (לקריאה בלבד); צוותים בכל תחום — שינוי שם, שינוי סדר (גרירה), הוספה והסרה. למנהל המערכת בלבד.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Lock, Plus, Trash2, ChevronDown, Loader2, AlertTriangle, Diamond, GripVertical } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, weekNumber, weekYear } from "@/lib/weeks";
import { useToast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { useCatalog } from "@/components/CatalogProvider";

type STeam = { id: number; name: string; key: string; items: number; milestones: number };
type SDomain = { id: number; name: string; teams: STeam[] };
type Contents = { items: { id: number; name: string; startWeek: string; endWeek: string; status: string }[]; milestones: { id: number; name: string; date: string }[] };

const KEY = ["admin-structure"];

export function StructureSettings() {
  const q = useQuery({ queryKey: KEY, queryFn: () => api<SDomain[]>("GET", "/api/admin/structure") });
  const [removing, setRemoving] = useState<{ team: STeam; domain: SDomain } | null>(null);
  if (q.isLoading) return <div className="card p-10 text-center text-ink-500">טוען…</div>;
  return (
    <div className="space-y-3" data-testid="structure-settings">
      <p className="text-[12.5px] text-ink-500">
        התחומים קבועים ואינם ניתנים לשינוי. בכל תחום אפשר לשנות שמות צוותים, לשנות את סדרם (גרירה בידית שמימין), להוסיף צוות ולהסיר צוות.
        הרשאות העריכה ניתנות לפי תחום — לכן צוות חדש פתוח מיד לעריכה לכל מי שיש לו הרשאה לתחום, והשינויים מופיעים בגאנט, בסינון, בטבלה ובייבוא בעזרת AI.
      </p>
      {(q.data ?? []).map((d) => <DomainCard key={d.id} d={d} onRemove={(team) => setRemoving({ team, domain: d })} />)}
      {removing && <RemoveTeamDialog team={removing.team} domain={removing.domain} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: ["plan"] }); };
}

function DomainCard({ d, onRemove }: { d: SDomain; onRemove: (t: STeam) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const single = d.teams.length === 1 && d.teams[0].name === d.name;
  // סדר הצוותים: מוצג מיד בזמן הגרירה, ונשמר בשחרור. מתעדכן מהשרת כשהרשימה משתנה
  const serverIds = d.teams.map((t) => t.id).join(",");
  const [order, setOrder] = useState<number[]>(() => d.teams.map((t) => t.id));
  useEffect(() => { setOrder(d.teams.map((t) => t.id)); }, [serverIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState<{ id: number; over: number | null; after: boolean } | null>(null);
  const [armed, setArmed] = useState<number | null>(null); // גרירה רק מהידית — כדי שלא תפריע לעריכת השם
  const teamsInOrder = order.map((id) => d.teams.find((t) => t.id === id)).filter(Boolean) as STeam[];
  const saveOrder = async (next: number[]) => {
    if (next.join(",") === order.join(",")) return;
    const prev = order;
    setOrder(next);
    try {
      await api("POST", "/api/admin/teams/order", { domainId: d.id, teamIds: next });
      toast.show("success", "סדר הצוותים עודכן");
      refresh();
    } catch (e) { toast.show("error", (e as Error).message); setOrder(prev); refresh(); }
  };
  const move = (id: number, target: number, after: boolean) => {
    const rest = order.filter((x) => x !== id);
    let idx = rest.indexOf(target);
    if (idx < 0) return;
    if (after) idx++;
    void saveOrder([...rest.slice(0, idx), id, ...rest.slice(idx)]);
  };
  const step = (id: number, dir: -1 | 1) => {
    const i = order.indexOf(id), j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]];
    void saveOrder(next);
  };
  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api("POST", "/api/admin/teams", { domainId: d.id, name: name.trim() });
      toast.show("success", `הצוות "${name.trim()}" נוסף לתחום ${d.name}`);
      setName(""); setAdding(false); refresh();
    } catch (e) { toast.show("error", (e as Error).message); }
    setBusy(false);
  };
  return (
    <section className="card p-4" data-testid={`structure-domain-${d.id}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[14px] font-semibold text-ink-900">{d.name}</span>
        <span className="flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-500" title="התחומים קבועים ואינם ניתנים לעריכה"><Lock size={10} />תחום קבוע</span>
        {single && <span className="text-[11.5px] text-ink-400">מוצג בגאנט כתחום עם צוות יחיד; הוספת צוות תפצל אותו לתחום עם צוותים</span>}
      </div>
      <div className="divide-y divide-ink-100" data-testid={`structure-teams-${d.id}`}>
        {teamsInOrder.map((t) => (
          <div key={t.id} draggable={armed === t.id} data-team-row={t.id}
            className={clsx("relative", drag?.id === t.id && "opacity-40")}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(t.id)); setDrag({ id: t.id, over: null, after: false }); }}
            onDragOver={(e) => {
              if (!drag || drag.id === t.id) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > r.top + r.height / 2;
              if (drag.over !== t.id || drag.after !== after) setDrag({ ...drag, over: t.id, after });
            }}
            onDrop={(e) => { e.preventDefault(); if (drag && drag.over !== null) move(drag.id, drag.over, drag.after); setDrag(null); setArmed(null); }}
            onDragEnd={() => { setDrag(null); setArmed(null); }}>
            {/* קו שמראה לאן הצוות ייכנס */}
            {drag?.over === t.id && <span className={clsx("pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-brand-500", drag.after ? "-bottom-px" : "-top-px")} />}
            <TeamRow t={t} last={d.teams.length === 1} onRemove={() => onRemove(t)}
              handle={d.teams.length > 1 ? (
                <button className="icon-btn h-7 w-6 shrink-0 cursor-grab text-ink-400 hover:text-ink-700 active:cursor-grabbing" title="גרירה לשינוי הסדר (או חצים למעלה/למטה)"
                  aria-label={`שינוי מיקום הצוות ${t.name}`} data-testid={`team-handle-${t.id}`}
                  onMouseDown={() => setArmed(t.id)} onMouseUp={() => { if (!drag) setArmed(null); }}
                  onKeyDown={(e) => { if (e.key === "ArrowUp") { e.preventDefault(); step(t.id, -1); } if (e.key === "ArrowDown") { e.preventDefault(); step(t.id, 1); } }}>
                  <GripVertical size={15} />
                </button>
              ) : null} />
          </div>
        ))}
      </div>
      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <input className="input h-8 max-w-[260px]" autoFocus placeholder="שם הצוות החדש" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); if (e.key === "Escape") { setAdding(false); setName(""); } }} data-testid={`new-team-name-${d.id}`} />
          <button className="btn-primary btn-sm" disabled={!name.trim() || busy} onClick={() => void add()} data-testid={`new-team-save-${d.id}`}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}הוספה</button>
          <button className="btn-ghost btn-sm" onClick={() => { setAdding(false); setName(""); }}>ביטול</button>
        </div>
      ) : (
        <button className="btn-ghost btn-sm mt-2 text-brand-600" onClick={() => setAdding(true)} data-testid={`add-team-${d.id}`}><Plus size={13} />הוספת צוות</button>
      )}
    </section>
  );
}

function TeamRow({ t, last, onRemove, handle }: { t: STeam; last: boolean; onRemove: () => void; handle?: React.ReactNode }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(t.name);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== t.name;
  const save = async () => {
    if (!dirty || !name.trim() || saving) { if (!name.trim()) setName(t.name); return; }
    setSaving(true);
    try { await api("PATCH", `/api/admin/teams/${t.id}`, { name: name.trim() }); toast.show("success", "שם הצוות עודכן"); refresh(); }
    catch (e) { toast.show("error", (e as Error).message); setName(t.name); }
    setSaving(false);
  };
  return (
    <div className="flex items-center gap-3 py-1.5" data-testid={`structure-team-${t.id}`}>
      {handle}
      <input className={clsx("input h-8 max-w-[260px]", dirty && "border-brand-500")} value={name} onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setName(t.name); }}
        aria-label="שם הצוות" data-testid={`team-name-${t.id}`} />
      {saving && <Loader2 size={14} className="animate-spin text-ink-400" />}
      <span className="text-[12px] text-ink-400">{t.items} תכולות{t.milestones ? ` · ${t.milestones} אבני דרך` : ""}</span>
      <button className="icon-btn mr-auto text-ink-400 hover:text-red-600 disabled:opacity-30" disabled={last} onClick={onRemove}
        title={last ? "לתחום חייב להישאר לפחות צוות אחד" : "הסרת הצוות"} aria-label="הסרת הצוות" data-testid={`remove-team-${t.id}`}><Trash2 size={15} /></button>
    </div>
  );
}

function RemoveTeamDialog({ team, domain, onClose }: { team: STeam; domain: SDomain; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const cat = useCatalog();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const contents = useQuery({ queryKey: ["team-contents", team.id], queryFn: () => api<Contents>("GET", `/api/admin/teams/${team.id}/contents`), enabled: show });
  const total = team.items + team.milestones;
  const remove = async () => {
    setBusy(true);
    try {
      const r = await api<{ items: number; milestones: number }>("DELETE", `/api/admin/teams/${team.id}`);
      toast.show("success", `הצוות "${team.name}" הוסר${r.items + r.milestones ? ` (${r.items} תכולות, ${r.milestones} אבני דרך נמחקו)` : ""}`);
      refresh(); onClose();
    } catch (e) { toast.show("error", (e as Error).message); setBusy(false); }
  };
  const wk = (s: string) => `שבוע ${weekNumber(s)} · ${weekYear(s)}`;
  return (
    <Dialog open onClose={onClose} width={total ? 620 : 440}
      title={<span className="flex items-center gap-2"><AlertTriangle size={18} className="text-amber-500" />הסרת הצוות &quot;{team.name}&quot; ({domain.name})</span>}
      footer={<>
        <button className="btn-danger" disabled={busy} onClick={() => void remove()} data-testid="confirm-remove-team">{busy && <Loader2 size={13} className="animate-spin" />}הסרת הצוות</button>
        <button className="btn-secondary" onClick={onClose}>ביטול</button>
      </>}>
      <div className="space-y-3 text-[13px] leading-relaxed text-ink-700" data-testid="remove-team-dialog">
        {total === 0 ? <p>הצוות ריק. האם אתה בטוח שברצונך להסיר אותו?</p> : (
          <>
            <p>
              בצוות יש <b>{team.items} תכולות</b>{team.milestones ? <> ו-<b>{team.milestones} אבני דרך</b></> : null}.
              האם אתה בטוח? הן יימחקו יחד עם הצוות ויוסרו מהגאנט.
            </p>
            <p className="text-[12px] text-ink-500">המחיקה רכה: המידע נשמר בבסיס הנתונים, ביומן הפעולות ובתמונות המצב שכבר נשמרו.</p>
            <button className="btn-secondary btn-sm" onClick={() => setShow((s) => !s)} data-testid="show-team-contents">
              <ChevronDown size={13} className={clsx("transition", show && "rotate-180")} />{show ? "הסתרת התכולות" : "הצגת התכולות"}
            </button>
            {show && (
              <div className="max-h-[38vh] overflow-auto rounded-lg border border-ink-200" data-testid="team-contents">
                {contents.isLoading ? <div className="p-4 text-center text-ink-500">טוען…</div> : (
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 bg-ink-50 text-ink-500"><tr>{["שם", "סטטוס", "שבועות"].map((h) => <th key={h} className="px-2 py-1.5 text-start font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {contents.data?.items.map((i) => (
                        <tr key={`i${i.id}`} className="border-t border-ink-100">
                          <td className="px-2 py-1">{i.name}</td>
                          <td className="px-2 py-1 text-ink-500">{cat.status(i.status).label}</td>
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums text-ink-500">{i.startWeek === i.endWeek ? wk(i.startWeek) : `${wk(i.startWeek)} – ${wk(i.endWeek)}`}</td>
                        </tr>
                      ))}
                      {contents.data?.milestones.map((m) => (
                        <tr key={`m${m.id}`} className="border-t border-ink-100">
                          <td className="px-2 py-1"><span className="inline-flex items-center gap-1"><Diamond size={11} className="text-violet-600" />{m.name}</span></td>
                          <td className="px-2 py-1 text-ink-500">אבן דרך</td>
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums text-ink-500">{fmtDate(m.date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
