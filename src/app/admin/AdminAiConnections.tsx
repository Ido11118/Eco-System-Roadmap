"use client";
// ניהול מערכת ← משתמשים: חיבורי ה-AI של המשתמש (Claude / ChatGPT) — מוצגים בכרטיס המשתמש, עם ניתוק.
// הרשימה נטענת פעם אחת לכל המשתמשים (אותו מפתח שאילתה בכל הכרטיסים).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Unplug } from "lucide-react";
import { api } from "@/lib/api";
import { fmtTs } from "@/components/plan/ui";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog";

type Conn = {
  id: number; client: string; access: "read" | "write"; createdAt: string; lastUsedAt: string | null;
  userId: number; userName: string; userEmail: string; userStatus: string;
};
const KEY = ["admin-ai-connections"];

export function UserAiConnections({ userId, userName }: { userId: number; userName: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<Conn[]>("GET", "/api/admin/connections"), refetchInterval: 30000 });
  const list = (q.data ?? []).filter((c) => c.userId === userId);
  if (!list.length) return null;
  const revoke = async (c: Conn) => {
    if (!(await confirm({
      title: `לנתק את ${c.client} של ${userName}?`, confirm: "ניתוק", danger: true,
      text: <>העוזר יאבד מיד את הגישה לתוכנית העבודה. המשתמש יוכל לחבר אותו מחדש בעצמו (כדי למנוע — משעים את המשתמש).</>,
    }))) return;
    try { await api("DELETE", `/api/admin/connections/${c.id}`); toast.show("success", `${c.client} של ${userName} נותק`); }
    catch (e) { toast.show("error", (e as Error).message); }
    void qc.invalidateQueries({ queryKey: KEY });
  };
  return (
    <div className="mt-2 space-y-1" data-testid={`user-ai-${userId}`}>
      {list.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-600" data-testid={`admin-connection-${c.id}`}>
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700">
            <Bot size={12} />מחובר ל-<bdi>{c.client}</bdi>
          </span>
          <span className={c.access === "write" ? "font-medium text-amber-700" : "text-ink-500"}>{c.access === "write" ? "קריאה ועריכה" : "קריאה בלבד"}</span>
          <span className="text-ink-400">· {c.lastUsedAt ? `שימוש אחרון ${fmtTs(c.lastUsedAt)}` : `חובר ${fmtTs(c.createdAt)}`}</span>
          <button className="inline-flex items-center gap-0.5 rounded px-1 text-red-600 hover:bg-red-50" onClick={() => void revoke(c)}
            data-testid={`admin-connection-revoke-${c.id}`} title="ניתוק החיבור"><Unplug size={12} />ניתוק</button>
        </div>
      ))}
    </div>
  );
}
