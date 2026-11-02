"use client";
// חלון ה-AI ← "חיבור Claude / ChatGPT": כתובת שרת ה-MCP, מצב החיבור של המשתמש, והוראות חיבור מדויקות לכל כלי.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Bot, Check, Copy, ExternalLink, Info, Lightbulb, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

type Conn = { id: number; client: string; access: "read" | "write" };
type Tool = "claude" | "claude-org" | "chatgpt" | "claude-code";

const TOOLS: { key: Tool; label: string }[] = [
  { key: "claude", label: "Claude" },
  { key: "claude-org", label: "Claude לארגון (Team / Enterprise)" },
  { key: "chatgpt", label: "ChatGPT" },
  { key: "claude-code", label: "Claude Code" },
];

/** שם של כפתור / תפריט באנגלית כפי שמופיע בכלי */
const Ui = ({ children }: { children: React.ReactNode }) => (
  <bdi dir="ltr" className="rounded bg-ink-100 px-1 py-px font-mono text-[12px] text-ink-800">{children}</bdi>
);
const Arrow = () => <span className="mx-0.5 text-ink-400">←</span>;

export function McpGuide({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const toast = useToast();
  const [tool, setTool] = useState<Tool>("claude");
  const [copied, setCopied] = useState(false);
  const q = useQuery({ queryKey: ["ai-connections"], queryFn: () => api<{ mcpUrl: string; connections: Conn[] }>("GET", "/api/me/connections") });
  const url = q.data?.mcpUrl ?? "…";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); toast.show("success", "הכתובת הועתקה"); }
    catch { toast.show("error", "ההעתקה נחסמה — סמן את הכתובת והעתק ידנית"); }
  };
  const conns = q.data?.connections ?? [];
  const UrlBox = (
    <span className="inline-flex max-w-full items-center gap-1 align-middle">
      <bdi dir="ltr" className="truncate rounded bg-brand-50 px-1 font-mono text-[12px] text-brand-800">{url}</bdi>
    </span>
  );

  return (
    <div className="space-y-4 text-[13px] text-ink-700" data-testid="ai-mcp">
      <p>
        מחברים את <b>Claude</b> או את <b>ChatGPT</b> לתוכנית העבודה <b>פעם אחת</b>, ומאז פשוט כותבים להם בצ׳אט מה לעשות:
        לחפש ולסכם, להוסיף ולעדכן תכולות, אבני דרך, ספרינטים ובאקלוג, או להזיז תכולות בזמן. בלי להעתיק ולהדביק.
      </p>

      {/* מצב החיבור של המשתמש */}
      {conns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-800" data-testid="mcp-connected">
          <Check size={15} />
          <span>אתה כבר מחובר: {conns.map((c) => `${c.client} (${c.access === "write" ? "קריאה ועריכה" : "קריאה בלבד"})`).join(", ")}</span>
          {onOpenSettings && <button className="btn-ghost btn-sm mr-auto text-green-800 hover:bg-green-100" onClick={onOpenSettings}>ניהול החיבורים</button>}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-ink-500"><Bot size={15} />עדיין לא חיברת עוזר AI.</div>
      )}

      {/* שלב 1: הכתובת */}
      <section className="rounded-lg border border-ink-200 p-3">
        <div className="mb-1.5 font-semibold text-ink-900">כתובת החיבור — תצטרך אותה בשלבים למטה</div>
        <div className="flex gap-1.5">
          <input readOnly dir="ltr" className="input font-mono text-[12.5px]" value={url} onFocus={(e) => e.currentTarget.select()} data-testid="mcp-guide-url" />
          <button className="btn-primary shrink-0" onClick={() => void copy()} disabled={!q.data} data-testid="mcp-guide-copy">
            {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "הועתק" : "העתקה"}
          </button>
        </div>
      </section>

      {/* בחירת הכלי */}
      <section>
        <div className="mb-2 font-semibold text-ink-900">באיזה כלי אתה משתמש?</div>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TOOLS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tool === t.key} onClick={() => setTool(t.key)} data-testid={`mcp-tool-${t.key}`}
              className={clsx("rounded-full border px-3 py-1 text-[12.5px] font-medium", tool === t.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-600 hover:bg-ink-50")}>
              {t.label}
            </button>
          ))}
        </div>

        <ol className="mt-3 space-y-2.5" data-testid={`mcp-steps-${tool}`}>
          {tool === "claude" && <>
            <S n={1}>נכנסים ל-<a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" className="text-brand-600 underline">claude.ai</a> (או לאפליקציית Claude במחשב) ופותחים <Ui>Settings</Ui><Arrow /><Ui>Connectors</Ui>.</S>
            <S n={2}>לוחצים <Ui>Add custom connector</Ui>.</S>
            <S n={3}>בשדה <Ui>Name</Ui> כותבים <b>תוכנית עבודה</b>, ובשדה <Ui>URL</Ui> מדביקים את {UrlBox}. לוחצים <Ui>Add</Ui>.</S>
            <S n={4}>ליד ״תוכנית עבודה״ לוחצים <Ui>Connect</Ui>. נפתח חלון של המערכת.</S>
            <S n={5}>בחלון מתחברים (מייל וסיסמה או Google), בוחרים <b>קריאה בלבד</b> או <b>קריאה ועריכה</b>, ולוחצים <b>אישור וחיבור</b>.</S>
            <S n={6}>בצ׳אט: לוחצים על <Ui>+</Ui> (או על סמל הכלים) בתיבת ההקלדה<Arrow /><Ui>Connectors</Ui><Arrow />מפעילים את <b>תוכנית עבודה</b>. מעכשיו פשוט כותבים מה צריך.</S>
            <Note>זמין בכל התוכניות של Claude. בתוכנית החינמית אפשר להוסיף connector אחד בלבד. ייתכן ששמות התפריטים יהיו מעט שונים.</Note>
          </>}
          {tool === "claude-org" && <>
            <S n={1}><b>מנהל חשבון ה-Claude של הארגון (Owner)</b>, פעם אחת: <Ui>Settings</Ui><Arrow /><Ui>Organization settings</Ui><Arrow /><Ui>Connectors</Ui><Arrow /><Ui>Add custom connector</Ui>.</S>
            <S n={2}>שם: <b>תוכנית עבודה</b>. כתובת: {UrlBox}. לוחצים <Ui>Add</Ui>. מעכשיו ה-connector זמין לכל העובדים, אבל כל אחד מתחבר בנפרד, עם ההרשאות שלו.</S>
            <S n={3}><b>כל עובד</b>: <Ui>Settings</Ui><Arrow /><Ui>Connectors</Ui><Arrow />מוצא את ״תוכנית עבודה״<Arrow /><Ui>Connect</Ui>.</S>
            <S n={4}>בחלון של המערכת מתחברים, בוחרים רמת גישה ולוחצים <b>אישור וחיבור</b>.</S>
            <S n={5}>בצ׳אט: <Ui>+</Ui><Arrow /><Ui>Connectors</Ui><Arrow />מפעילים את <b>תוכנית עבודה</b>.</S>
          </>}
          {tool === "chatgpt" && <>
            <S n={1}>ב-ChatGPT פותחים <Ui>Settings</Ui><Arrow /><Ui>Apps &amp; Connectors</Ui><Arrow /><Ui>Advanced settings</Ui>, ומפעילים <Ui>Developer mode</Ui>.</S>
            <S n={2}>חוזרים ל-<Ui>Apps &amp; Connectors</Ui> ולוחצים <Ui>Create</Ui>.</S>
            <S n={3}>שם: <b>תוכנית עבודה</b>. בשדה <Ui>MCP Server URL</Ui> מדביקים את {UrlBox}. בשדה <Ui>Authentication</Ui> בוחרים <Ui>OAuth</Ui>.</S>
            <S n={4}>מסמנים שאתה סומך על ה-connector (<Ui>I trust this application</Ui>) ולוחצים <Ui>Create</Ui>. נפתח חלון של המערכת.</S>
            <S n={5}>בחלון מתחברים, בוחרים רמת גישה ולוחצים <b>אישור וחיבור</b>.</S>
            <S n={6}>בצ׳אט: <Ui>+</Ui><Arrow /><Ui>Developer mode</Ui><Arrow />בוחרים את <b>תוכנית עבודה</b>. לפני כל עריכה ChatGPT יבקש ממך אישור.</S>
            <Note>נדרשת תוכנית בתשלום (Plus / Pro / Business / Enterprise / Edu). ב-Business / Enterprise ייתכן שמנהל סביבת העבודה צריך לאפשר Developer mode. ייתכן ששמות התפריטים יהיו מעט שונים.</Note>
          </>}
          {tool === "claude-code" && <>
            <S n={1}>בטרמינל מריצים (פעם אחת):<pre dir="ltr" className="mt-1 overflow-x-auto rounded-md bg-ink-50 p-2 text-left font-mono text-[12px]">claude mcp add --transport http workplan {url}</pre></S>
            <S n={2}>פותחים את Claude Code (<Ui>claude</Ui> בטרמינל), מקלידים <Ui>/mcp</Ui>, בוחרים <b>workplan</b><Arrow /><Ui>Authenticate</Ui>.</S>
            <S n={3}>בחלון שנפתח בדפדפן מתחברים, בוחרים רמת גישה ולוחצים <b>אישור וחיבור</b>.</S>
            <Note>החיבור משותף לטרמינל ולתוסף של VS Code.</Note>
          </>}
        </ol>
      </section>

      <section className="rounded-lg bg-amber-50/70 p-3">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink-900"><Lightbulb size={15} className="text-amber-600" />מה אפשר לבקש</div>
        <ul className="list-disc space-y-0.5 pr-5 text-ink-600">
          <li>״מה בעבודה אצל עזרים 1 החודש?״</li>
          <li>״אילו תכולות עם תלויות פתוחות בתחום אג״ם?״</li>
          <li>״תזיז את כל התכולות של תחום אש שבוע קדימה.״</li>
          <li>״תוסיף לבאקלוג של אג״ם: מחקר היתכנות לממשק חדש.״</li>
          <li>״הנה קובץ האקסל של התוכנית — תכניס את התכולות לגאנט.״</li>
        </ul>
      </section>

      <section className="space-y-1 text-[12.5px] text-ink-500">
        <div className="flex items-start gap-1.5"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-green-600" />העוזר פועל <b>עם ההרשאות שלך בלבד</b>: עורך רק בתחומים שמותרים לך, ו<b>לא יכול למחוק</b>.</div>
        <div className="flex items-start gap-1.5"><Info size={14} className="mt-0.5 shrink-0" />כל שינוי נרשם בהיסטוריה בשמך, עם הסימון ״(דרך Claude)״ או ״(דרך ChatGPT)״.</div>
        <div className="flex items-start gap-1.5"><ExternalLink size={14} className="mt-0.5 shrink-0" />מעבר בין קריאה בלבד לעריכה, או ניתוק — בכל רגע ב<b>הגדרות</b> (התפריט עם השם שלך למעלה)<Arrow /><b>חיבורי AI</b>.</div>
      </section>
    </div>
  );
}

function S({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">{n}</span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <li className="mr-7 rounded-md bg-ink-50 px-2.5 py-1.5 text-[12px] text-ink-500">{children}</li>;
}
