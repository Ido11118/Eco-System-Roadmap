"use client";
// "הוספת מופעים בעזרת AI": פרומפט מוכן להעתקה → שיחה חופשית בכלי AI → הדבקת JSON → תצוגה מקדימה ועריכה → אישור.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Copy, Check, Trash2, AlertCircle, AlertTriangle, ChevronDown, Sparkles, Loader2, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { todayIL, isISODate, weekStartOf, weekEndOf, weekNumber, weekYear, fmtDate, fmtShort } from "@/lib/weeks";
import {
  buildAiPrompt, parseImport, validateEntry, toPayload, placeTeamItems, CROSS_LABEL,
  type ImportEntry, type ImportKind, type ImportPerms, type ImportResult, type CrossKind,
} from "@/lib/aiImport";
import type { PlanData } from "@/lib/types";
import { Dialog, useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useCatalog } from "@/components/CatalogProvider";
import { PLAN_KEY, type PlanStore } from "./store";

/** כפתור בסרגל הצד: גלוי רק למי שיש לו הרשאת עריכה כלשהי (בתוכנית החיה) */
export function AiImportButton({ store }: { store: PlanStore }) {
  const [open, setOpen] = useState(false);
  const data = store.data;
  const canAny = !!data && (data.teams.some((t) => store.canEditTeam(t.id)) || store.canEditCross());
  if (!canAny) return null;
  return (
    <>
      {/* כפתור עגול בתחתית סרגל הצד (40px — נכנס גם כשהסרגל מכווץ) */}
      <button onClick={() => setOpen(true)} data-testid="ai-import-open" aria-label="הוספה בעזרת AI" title="הוספה בעזרת AI — תכולות, אבני דרך, ספרינטים ופריטי באקלוג בשיחה עם כלי AI"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-600 to-brand-600 text-white shadow-pop transition-transform duration-150 hover:scale-105 hover:from-fuchsia-700 hover:to-brand-700">
        <Sparkles size={18} />
      </button>
      <AiImportDialog store={store} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const KIND_TITLE: Record<ImportKind, string> = { item: "תכולות", milestone: "אבני דרך", sprint: "ספרינטים", backlog: "באקלוג (בלי שבועות — לשיבוץ בהמשך)" };

export function AiImportDialog({ store, open, onClose }: { store: PlanStore; open: boolean; onClose: () => void }) {
  const data = store.data;
  const cat = useCatalog();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [parsedText, setParsedText] = useState<string | null>(null); // הטקסט שממנו נבנתה התצוגה המקדימה
  const [entries, setEntries] = useState<ImportEntry[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState(false);

  const perms: ImportPerms = useMemo(() => ({
    canEditTeam: (id) => store.canEditTeam(id), canEditCross: () => store.canEditCross(), canEditDomain: (id) => store.canEditDomain(id),
  }), [store]);
  const prompt = useMemo(() => (data ? buildAiPrompt(data, perms, cat, todayIL()) : ""), [data, perms, cat]);
  const checked = useMemo(() => (entries && data ? entries.map((e) => ({ e, errors: validateEntry(e, data, perms) })) : []), [entries, data, perms]);
  const valid = checked.filter((c) => !c.errors.length).map((c) => c.e);
  const invalidCount = checked.length - valid.length;
  // כמה שורות חדשות ייווצרו (תצוגה בלבד — השרת משבץ מחדש מול הנתונים העדכניים)
  const newRows = useMemo(() => {
    if (!data) return 0;
    const list = toPayload(valid).items.filter((i) => i.teamId !== null) as { teamId: number; startWeek: string; endWeek: string }[];
    return new Set(placeTeamItems(data.rows, data.items, list).map((p, i) => ("newRow" in p ? `${list[i].teamId}:${p.newRow}` : null)).filter(Boolean)).size;
  }, [data, valid]);

  if (!data) return null;

  const reset = () => { setText(""); setParsedText(null); setEntries(null); setParseError(null); setShowPrompt(false); };
  const close = async () => {
    if (entries?.length && !(await confirm({ title: "סגירת חלון הייבוא", text: "התצוגה המקדימה והשינויים שעשית בה יימחקו. לסגור?", confirm: "סגירה", danger: true }))) return;
    reset(); onClose();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2500); toast.show("success", "הפרומפט הועתק"); }
    catch { setShowPrompt(true); toast.show("error", "ההעתקה האוטומטית נחסמה — סמן את הפרומפט והעתק ידנית"); }
  };
  const parse = () => {
    try { setEntries(parseImport(text, data, cat)); setParsedText(text); setParseError(null); }
    catch (e) { setEntries(null); setParseError((e as Error).message); }
  };
  const patch = (uid: string, p: Partial<ImportEntry>) => setEntries((es) => es?.map((e) => (e.uid === uid ? { ...e, ...p } : e)) ?? null);
  const remove = (uid: string) => setEntries((es) => es?.filter((e) => e.uid !== uid) ?? null);

  // למה כפתור האישור נעול: חובה לראות תצוגה מקדימה עדכנית של מה שייכנס לגאנט לפני האישור
  const stale = entries !== null && parsedText !== null && text !== parsedText;
  const lockReason = !entries
    ? (text.trim() ? "כדי לאשר, לחץ קודם על \"בדיקה ותצוגה מקדימה\" ובדוק מה ייכנס לגאנט" : "כדי לאשר, הדבק את הפלט מכלי ה-AI (שלב 3) וצפה בתצוגה המקדימה")
    : stale ? "הטקסט שהודבק השתנה מאז התצוגה המקדימה — לחץ שוב על \"בדיקה ותצוגה מקדימה\""
    : !valid.length ? "אין פריטים תקינים לייבוא — תקן את השגיאות בתצוגה המקדימה"
    : null;
  const submit = async () => {
    if (lockReason || busy) return;
    setBusy(true);
    try {
      const res = await api<ImportResult>("POST", "/api/import", toPayload(valid));
      await Promise.all([qc.invalidateQueries({ queryKey: PLAN_KEY }), qc.invalidateQueries({ queryKey: ["backlog"] })]);
      const n = res.itemIds.length + res.milestoneIds.length + res.sprintIds.length;
      const nb = res.backlogIds.length;
      const what = [n ? `${n} פריטים לגאנט` : "", nb ? `${nb} לבאקלוג` : ""].filter(Boolean).join(" ו-");
      toast.show("success", `נוספו ${what}${invalidCount ? ` (${invalidCount} עם שגיאות לא יובאו)` : ""}`, {
        ttl: 15000,
        action: { label: "ביטול הייבוא", run: () => { void undo(res); } },
      });
      reset(); onClose();
    } catch (e) { toast.show("error", (e as Error).message); }
    setBusy(false);
  };
  const undo = async (res: ImportResult) => {
    try {
      const r = await api<{ removed: number; skipped: number }>("POST", "/api/import/undo", res);
      await Promise.all([qc.invalidateQueries({ queryKey: PLAN_KEY }), qc.invalidateQueries({ queryKey: ["backlog"] })]);
      toast.show("success", `הייבוא בוטל (${r.removed} פריטים הוסרו${r.skipped ? `; ${r.skipped} נערכו בינתיים ונשארו` : ""})`);
    } catch (e) { toast.show("error", (e as Error).message); }
  };

  const byKind = (k: ImportKind) => checked.filter((c) => c.e.kind === k);
  return (
    <Dialog open={open} onClose={() => void close()} width={1120}
      title={<span className="flex items-center gap-2"><Sparkles size={17} className="text-fuchsia-600" />הוספת מופעים בעזרת AI</span>}
      footer={<>
        <button className="btn-primary" disabled={!!lockReason || busy} onClick={() => void submit()} data-testid="ai-import-submit" title={lockReason ?? undefined}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          אישור והוספה לגאנט{valid.length ? ` (${valid.length})` : ""}
        </button>
        <button className="btn-secondary" onClick={() => void close()}>ביטול</button>
        {lockReason
          ? <span className="flex items-center gap-1 text-[12px] text-ink-500" data-testid="ai-lock-reason"><Lock size={12} />{lockReason}</span>
          : invalidCount > 0 && <span className="text-[12px] text-red-600">{invalidCount} פריטים עם שגיאות לא ייובאו — תקן או מחק אותם</span>}
      </>}>
      {/* overflow-anchor: בלי "עיגון גלילה" של הדפדפן — אחרת פתיחת הפרומפט גוללת את החלון אל תיבת ההדבקה שבפוקוס */}
      <div className="space-y-4 text-[13px] [overflow-anchor:none]" data-testid="ai-import">
        <Step n={1} title="העתק את הפרומפט ושלח אותו לכלי AI לבחירתך (ChatGPT, Claude, Gemini וכו')">
          <p className="text-ink-500">הפרומפט מסביר לכלי מה אפשר ליצור, אילו צוותים ותחומים פתוחים לעריכה עבורך, ואיך להחזיר את התוצאה.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="btn-primary btn-sm" onClick={() => void copy()} data-testid="ai-copy-prompt">
              {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "הועתק" : "העתקת הפרומפט"}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setShowPrompt((s) => !s)}>
              <ChevronDown size={13} className={clsx("transition", showPrompt && "rotate-180")} />{showPrompt ? "הסתרת הפרומפט" : "הצגת הפרומפט"}
            </button>
          </div>
          {showPrompt && <PromptView prompt={prompt} />}
        </Step>

        <Step n={2} title="בנה בשיחה את התכולות, אבני הדרך, הספרינטים ופריטי הבאקלוג">
          <p className="text-ink-500">תאר בשפה חופשית מה אתה רוצה לתכנן, או העלה קובץ (Excel, מסמך, מצגת). הכלי ישאל שאלות הבהרה ויציג סיכום לאישור. בסוף בקש ממנו &quot;פלט סופי&quot;.</p>
        </Step>

        <Step n={3} title="הדבק כאן את הפלט הסופי מהשיחה (ה-JSON)">
          <textarea dir="ltr" className="input h-32 font-mono text-[11.5px]" placeholder={'```json\n{ "format": "workplan-import/v1", "items": [ ... ] }\n```'}
            value={text} onChange={(e) => setText(e.target.value)} data-testid="ai-json" />
          <div className="mt-2 flex items-center gap-2">
            <button className={clsx("btn-sm", text.trim() && (!entries || stale) ? "btn-primary" : "btn-secondary")} disabled={!text.trim()} onClick={parse} data-testid="ai-parse">בדיקה ותצוגה מקדימה</button>
            {parseError && <span className="flex items-center gap-1 text-[12.5px] text-red-600" data-testid="ai-parse-error"><AlertCircle size={14} />{parseError}</span>}
          </div>
        </Step>

        {entries && (
          <Step n={4} title="ודא בתצוגה המקדימה שהמידע תקין — אפשר לערוך ולמחוק">
            <div className="mb-2 flex flex-wrap gap-3 text-[12.5px]" data-testid="ai-summary">
              <span className="text-green-700">✓ {valid.length} ייובאו</span>
              {invalidCount > 0 && <span className="text-red-600">✗ {invalidCount} עם שגיאות (לא ייובאו)</span>}
              {newRows > 0 && <span className="text-ink-500">ייווצרו {newRows} שורות חדשות כדי למנוע חפיפה</span>}
            </div>
            {entries.length === 0 && <div className="card p-4 text-center text-ink-500">כל הפריטים נמחקו מהתצוגה המקדימה.</div>}
            {(["item", "milestone", "sprint", "backlog"] as const).map((k) => byKind(k).length > 0 && (
              <div key={k} className="mb-3">
                <div className="mb-1 font-semibold">{KIND_TITLE[k]} ({byKind(k).length})</div>
                <div className="overflow-x-auto rounded-lg border border-ink-200">
                  <table className="w-full text-[12.5px]">
                    {/* אותן עמודות ובאותו סדר כמו בטבלת התכולות */}
                    <thead className="bg-ink-50 text-ink-500">
                      <tr>
                        {["תחום", k === "backlog" ? "צוות (לא חובה)" : "צוות", "שם", "תיעדוף", "סטטוס", "הערות", k === "item" ? "שבוע התחלה" : k === "milestone" ? "שבוע (תאריך)" : k === "backlog" ? "" : "התחלה", k === "item" ? "שבוע סיום" : k === "sprint" ? "סיום" : ""].map((h, i) => (
                          <th key={i} className="whitespace-nowrap px-2 py-1.5 text-start font-medium">{h}</th>
                        ))}
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {byKind(k).map(({ e, errors }) => (
                        <EntryRow key={e.uid} e={e} errors={errors} data={data} perms={perms} onPatch={(p) => patch(e.uid, p)} onRemove={() => remove(e.uid)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </Step>
        )}

        {entries && valid.length > 0 && (
          <Step n={5} title="אשר — הכל ייכנס לגאנט (ופריטי הבאקלוג — לבאקלוג)">
            <p className="text-ink-500">לחץ &quot;אישור והוספה לגאנט&quot; למטה. אחרי ההוספה יופיע כפתור &quot;ביטול הייבוא&quot; למקרה של טעות.</p>
          </Step>
        )}
      </div>
    </Dialog>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[12px] font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 font-semibold text-ink-900">{title}</div>
        {children}
      </div>
    </section>
  );
}

function EntryRow({ e, errors, data, perms, onPatch, onRemove }: {
  e: ImportEntry; errors: string[]; data: PlanData; perms: ImportPerms; onPatch: (p: Partial<ImportEntry>) => void; onRemove: () => void;
}) {
  const cat = useCatalog();
  const bad = errors.length > 0;
  const cell = "px-2 py-1 align-top";
  const inp = "input h-7 px-1.5 text-[12px]";
  // ערך הבחירה של היעד: t:<צוות> / d:<תחום שלם — אבן דרך> / x:<שורה רוחבית> / x: (אבן דרך רוחבית) / "" (לא זוהה)
  const target = e.kind === "item" ? (e.cross ? `x:${e.cross}` : e.teamId ? `t:${e.teamId}` : "")
    : e.teamId ? `t:${e.teamId}` : e.domainId ? `d:${e.domainId}` : e.targetError ? "" : "x:";
  const setTarget = (v: string) => {
    if (v.startsWith("t:")) onPatch({ teamId: Number(v.slice(2)), domainId: null, cross: null, targetError: undefined });
    else if (v.startsWith("d:")) onPatch({ teamId: null, domainId: Number(v.slice(2)), cross: null, targetError: undefined });
    else if (v.startsWith("x:")) onPatch({ teamId: null, domainId: null, cross: (v.slice(2) || null) as CrossKind | null, targetError: undefined });
  };
  const teamOptions = data.domains.map((d) => {
    const ts = data.teams.filter((t) => t.domainId === d.id && (perms.canEditTeam(t.id) || t.id === e.teamId));
    // אבן דרך: אפשר גם לכל התחום (בתחום עם צוות יחיד — הצוות הוא התחום)
    const wholeDomain = e.kind === "milestone" && !d.isSingleTeam && (perms.canEditDomain(d.id) || e.domainId === d.id);
    return ts.length || wholeDomain ? (
      <optgroup key={d.id} label={d.name}>
        {wholeDomain && <option value={`d:${d.id}`} disabled={!perms.canEditDomain(d.id)}>{d.name} — כל התחום{perms.canEditDomain(d.id) ? "" : " (אין הרשאה)"}</option>}
        {ts.map((t) => <option key={t.id} value={`t:${t.id}`} disabled={!perms.canEditTeam(t.id)}>{t.name}{perms.canEditTeam(t.id) ? "" : " (אין הרשאה)"}</option>)}
      </optgroup>
    ) : null;
  });
  return (
    <>
      <tr className={clsx("border-t border-ink-100", bad && "bg-red-50/70")} data-testid={`ai-row-${e.kind}`} data-invalid={bad || undefined}>
        {/* תחום: נגזר מהצוות (בספרינט — נבחר ישירות) */}
        <td className={clsx(cell, "whitespace-nowrap pt-2 text-ink-600")}>
          {e.kind === "sprint" || e.kind === "backlog" ? (
            <select className={clsx(inp, !e.domainId && "text-ink-400")} value={e.domainId ?? ""} data-testid={`ai-domain-${e.kind}`}
              onChange={(ev) => {
                const domainId = Number(ev.target.value) || null;
                // באקלוג: החלפת תחום מנקה צוות שלא שייך אליו
                const keepTeam = e.kind === "backlog" && e.teamId !== null && data.teams.find((t) => t.id === e.teamId)?.domainId === domainId;
                onPatch({ domainId, targetError: undefined, ...(e.kind === "backlog" && !keepTeam ? { teamId: null } : {}) });
              }}>
              <option value="" disabled>בחר תחום…</option>
              {data.domains.filter((d) => perms.canEditDomain(d.id) || d.id === e.domainId).map((d) => (
                <option key={d.id} value={d.id} disabled={!perms.canEditDomain(d.id)}>{d.name}{perms.canEditDomain(d.id) ? "" : " (אין הרשאה)"}</option>
              ))}
            </select>
          ) : e.teamId ? data.domains.find((d) => d.id === data.teams.find((t) => t.id === e.teamId)?.domainId)?.name
            : e.kind === "milestone" && e.domainId ? data.domains.find((d) => d.id === e.domainId)?.name
            : (e.cross || (e.kind === "milestone" && !e.targetError)) ? "רוחבי" : <span className="text-[11.5px] text-ink-300">לפי הצוות</span>}
        </td>
        <td className={cell}>
          {e.kind === "sprint" ? <NA kind={e.kind} /> : e.kind === "backlog" ? (
            // באקלוג: צוות לא חובה; צוות מתחום אחר מחליף גם את התחום
            <select className={clsx(inp, e.teamId === null && "text-ink-400")} value={e.teamId ?? ""} data-testid="ai-team-backlog"
              onChange={(ev) => {
                const t = data.teams.find((x) => x.id === Number(ev.target.value));
                onPatch(t ? { teamId: t.id, domainId: t.domainId, targetError: undefined } : { teamId: null });
              }}>
              <option value="">— ללא צוות —</option>
              {data.domains.filter((d) => perms.canEditDomain(d.id)).map((d) => {
                const ts = data.teams.filter((t) => t.domainId === d.id);
                return ts.length ? <optgroup key={d.id} label={d.name}>{ts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup> : null;
              })}
            </select>
          ) : (
            <select className={clsx(inp, !target && "text-ink-400")} value={target} onChange={(ev) => setTarget(ev.target.value)}>
              <option value="" disabled>בחר צוות…</option>
              {teamOptions}
              {(perms.canEditCross() || (e.kind === "item" ? !!e.cross : e.teamId === null && e.domainId === null && !e.targetError)) && (
                <optgroup label="רוחבי">
                  {e.kind === "item"
                    ? (Object.keys(CROSS_LABEL) as CrossKind[]).map((c) => <option key={c} value={`x:${c}`}>{CROSS_LABEL[c]}</option>)
                    : <option value="x:">אבן דרך רוחבית</option>}
                </optgroup>
              )}
            </select>
          )}
        </td>
        <td className={cell}><input className={clsx(inp, "min-w-[180px]")} placeholder="הזן שם…" value={e.name} onChange={(ev) => onPatch({ name: ev.target.value })} /></td>
        <td className={cell}>
          {e.kind !== "item" && e.kind !== "backlog" ? <NA kind={e.kind} /> : (
            <select className={clsx(inp, "min-w-[88px]", !e.priority && "text-ink-400")} value={e.priority} onChange={(ev) => onPatch({ priority: ev.target.value })} title={e.priority ? undefined : "ריק — ייקבע ערך ברירת המחדל"}>
              <option value="">בחר…</option>
              {cat.priorities.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          )}
        </td>
        <td className={cell}>
          {e.kind !== "item" ? <NA kind={e.kind} /> : (
            <select className={clsx(inp, "min-w-[104px]", !e.status && "text-ink-400")} value={e.status} onChange={(ev) => onPatch({ status: ev.target.value })} title={e.status ? undefined : "ריק — ייקבע ערך ברירת המחדל"}>
              <option value="">בחר…</option>
              {cat.statuses.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          )}
        </td>
        <td className={cell}><input className={clsx(inp, "min-w-[140px]")} placeholder="הוסף הערה…" value={e.notes} onChange={(ev) => onPatch({ notes: ev.target.value })} /></td>
        <td className={cell}>{e.kind === "backlog" ? <NA kind={e.kind} /> : <WeekCell value={e.start} exact={e.kind !== "item"} onChange={(v) => onPatch({ start: v })} />}</td>
        <td className={cell}>{e.kind === "milestone" || e.kind === "backlog" ? <NA kind={e.kind} /> : <WeekCell value={e.end} exact={e.kind !== "item"} onChange={(v) => onPatch({ end: v })} />}</td>
        <td className={cell}><button className="icon-btn text-ink-400 hover:text-red-600" onClick={onRemove} aria-label="הסרה מהייבוא" title="הסרה מהייבוא"><Trash2 size={14} /></button></td>
      </tr>
      {(bad || e.warnings.length > 0) && (
        <tr className={clsx(bad ? "bg-red-50/70" : "bg-amber-50/60")}>
          <td colSpan={9} className="px-2 pb-1.5 pt-0 text-[11.5px]">
            {errors.map((x) => <div key={x} className="flex items-center gap-1 text-red-700" data-testid="ai-row-error"><AlertCircle size={12} />{x} — לא ייובא</div>)}
            {e.warnings.map((x) => <div key={x} className="flex items-center gap-1 text-amber-700"><AlertTriangle size={12} />{x}</div>)}
          </td>
        </tr>
      )}
    </>
  );
}

/** תא שבוע: מציג "שבוע N · שנה" (לא תאריך); בחירה בלוח השנה. ריק/לא תקין — "בחר שבוע…" וניתן למילוי.
 *  exact: אבן דרך/ספרינט שמורים כתאריך מדויק — היום מוצג בקטן ונשמר כפי שנבחר; בתכולה הבחירה מוצמדת ליום ראשון */
function WeekCell({ value, exact, onChange }: { value: string; exact?: boolean; onChange: (v: string) => void }) {
  const ok = isISODate(value);
  const w = ok ? weekStartOf(value) : "";
  return (
    <label className="relative block min-w-[118px]" title={ok ? `${fmtDate(w)}–${fmtDate(weekEndOf(w))}` : undefined}>
      <span className="input flex h-7 items-center gap-1 whitespace-nowrap px-1.5 text-[12px] tabular-nums">
        {ok ? <>שבוע {weekNumber(w)} <span className="text-ink-400">· {weekYear(w)}</span>{exact && <span className="text-[11px] text-ink-400">({fmtShort(value)})</span>}</>
          : <span className="text-ink-400">{exact ? "בחר תאריך…" : "בחר שבוע…"}</span>}
      </span>
      <input type="date" value={ok ? value : ""} onChange={(ev) => { if (isISODate(ev.target.value)) onChange(exact ? ev.target.value : weekStartOf(ev.target.value)); }}
        // לחיצה בכל מקום בתא פותחת את לוח השנה (גם כשהתא ריק)
        onClick={(ev) => { try { (ev.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* דפדפן ישן — הקלדה רגילה */ } }}
        className="absolute inset-0 cursor-pointer opacity-0" aria-label="בחירת שבוע" />
    </label>
  );
}

/** שדה שלא קיים בסוג הפריט הזה (למשל סטטוס לאבן דרך) — להבדיל משדה ריק שאפשר למלא */
function NA({ kind }: { kind: ImportKind }) {
  return <span className="block px-1.5 pt-1.5 text-ink-300" title={`לא רלוונטי ל${kind === "milestone" ? "אבן דרך" : kind === "backlog" ? "פריט באקלוג" : "ספרינט"}`}>—</span>;
}

/** תצוגת הפרומפט לקריאה נוחה: חלונית גבוהה עם גלילה, כותרות מודגשות ובלוק ה-JSON בגופן קוד */
function PromptView({ prompt }: { prompt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // בפתיחה: גוללים את חלון הייבוא כך ששלב 1 (הכותרת וכפתור ההעתקה) והפרומפט נראים
  useEffect(() => { requestAnimationFrame(() => ref.current?.closest("section")?.scrollIntoView({ block: "start" })); }, []);
  const blocks: React.ReactNode[] = [];
  const lines = prompt.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("```")) { // בלוק קוד עד הסגירה
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      blocks.push(<pre key={i} dir="ltr" className="my-1.5 overflow-x-auto rounded-md bg-ink-50 p-2.5 text-left font-mono text-[11.5px] leading-relaxed text-ink-700">{code.join("\n")}</pre>);
    } else if (l.startsWith("#")) {
      blocks.push(<div key={i} className={clsx("font-semibold text-ink-900", l.startsWith("###") ? "mt-2 text-[13px]" : "mt-3 text-[14px]")}>{l.replace(/^#+\s*/, "")}</div>);
    } else if (l.trim() === "") blocks.push(<div key={i} className="h-1.5" />);
    else if (l.startsWith("- ")) blocks.push(<div key={i} className="flex gap-1.5 pr-1"><span className="text-ink-400">•</span><span>{l.slice(2)}</span></div>);
    else blocks.push(<div key={i}>{l}</div>);
  }
  return (
    <div ref={ref} className="mt-2 h-[48vh] min-h-[300px] resize-y overflow-auto rounded-lg border border-ink-200 bg-white px-4 py-3 text-[13px] leading-relaxed text-ink-700" data-testid="ai-prompt">
      {blocks}
    </div>
  );
}
