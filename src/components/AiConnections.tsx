"use client";
// "חיבורי AI" בהגדרות: כתובת שרת ה-MCP להדבקה ב-Claude / ChatGPT, ורשימת החיבורים הפעילים — שינוי הרשאה וניתוק.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bot, Copy, Unplug } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/weeks";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog";

type Conn = { id: number; client: string; access: "read" | "write"; createdAt: string; lastUsedAt: string | null };
const KEY = ["ai-connections"];
const fmt = (iso: string) => fmtDate(iso.slice(0, 10));

export function AiConnections() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<{ mcpUrl: string; connections: Conn[] }>("GET", "/api/me/connections") });
  const setAccess = async (c: Conn, access: Conn["access"]) => {
    try { await api("PATCH", `/api/me/connections/${c.id}`, { access }); toast.show("success", `${c.client}: ${access === "write" ? "קריאה ועריכה" : "קריאה בלבד"}`); }
    catch (e) { toast.show("error", (e as Error).message); }
    qc.invalidateQueries({ queryKey: KEY });
  };
  const revoke = async (c: Conn) => {
    if (!(await confirm({ title: `לנתק את ${c.client}?`, text: "העוזר יאבד מיד את הגישה לתוכנית העבודה. אפשר לחבר אותו מחדש בכל עת.", confirm: "ניתוק", danger: true }))) return;
    try { await api("DELETE", `/api/me/connections/${c.id}`); toast.show("success", `${c.client} נותק`); }
    catch (e) { toast.show("error", (e as Error).message); }
    qc.invalidateQueries({ queryKey: KEY });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(q.data!.mcpUrl); toast.show("success", "הכתובת הועתקה"); } catch { /* הדפדפן חסם — הכתובת גלויה לבחירה ידנית */ }
  };
  return (
    <div className="space-y-4" data-testid="ai-connections">
      <section className="space-y-2 text-[13px] text-ink-700">
        <p>אפשר לחבר את <b>Claude</b> או את <b>ChatGPT</b> לתוכנית העבודה, ולבקש מהם לחפש, לסכם ולעדכן תכולות בשפה חופשית. העוזר פועל עם ההרשאות שלך בלבד, וכל שינוי נרשם בהיסטוריה בשמך. מחיקה לא אפשרית דרכו.</p>
        <div>
          <div className="label">כתובת החיבור (להדבקה בהגדרות ה-Connectors של העוזר)</div>
          <div className="flex gap-1.5">
            <input readOnly dir="ltr" className="input font-mono text-[12px]" value={q.data?.mcpUrl ?? "…"} onFocus={(e) => e.currentTarget.select()} data-testid="mcp-url" />
            <button className="btn-secondary shrink-0" onClick={() => void copy()} disabled={!q.data}><Copy size={13} />העתקה</button>
          </div>
        </div>
        <ul className="list-disc space-y-0.5 pr-5 text-[12.5px] text-ink-500">
          <li><b>Claude</b> (חשבון אישי בלבד — <b>לא עובד עם ה-Claude הארגוני שלנו</b>): Settings ← Connectors ← Add custom connector ← שם + הדבקת הכתובת ← Add, ואז Connect.</li>
          <li><b>ChatGPT</b>: בסרגל הצד ← Plugins ← בפינה הימנית העליונה Add ← Add custom MCP server ← שם + הדבקת הכתובת ← התחברות למשתמש שלך ומתן הרשאה.</li>
          <li>בחלון שייפתח מתחברים למערכת ובוחרים <b>קריאה בלבד</b> או <b>קריאה ועריכה</b>.</li>
        </ul>
      </section>
      <section>
        <div className="label">חיבורים פעילים</div>
        {q.isLoading ? <p className="text-[13px] text-ink-400">טוען…</p> : !q.data?.connections.length ? (
          <p className="rounded-md bg-ink-50 px-3 py-2 text-[13px] text-ink-500">אין חיבורים פעילים.</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
            {q.data.connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`connection-${c.id}`}>
                <Bot size={16} className="text-violet-600" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink-900"><bdi>{c.client}</bdi></div>
                  <div className="text-[11.5px] text-ink-400">חובר {fmt(c.createdAt)}{c.lastUsedAt ? ` · שימוש אחרון ${fmt(c.lastUsedAt)}` : ""}</div>
                </div>
                <div className="flex overflow-hidden rounded-md border border-ink-200 text-[12px]" role="radiogroup" aria-label="רמת גישה">
                  {(["read", "write"] as const).map((a) => (
                    <button key={a} role="radio" aria-checked={c.access === a} onClick={() => c.access !== a && void setAccess(c, a)} data-value={a}
                      className={clsx("px-2 py-1", c.access === a ? "bg-brand-600 text-white" : "bg-white text-ink-600 hover:bg-ink-50")}>
                      {a === "read" ? "קריאה בלבד" : "קריאה ועריכה"}
                    </button>
                  ))}
                </div>
                <button className="btn-ghost btn-sm text-red-600 hover:bg-red-50" onClick={() => void revoke(c)} data-testid="connection-revoke"><Unplug size={13} />ניתוק</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
