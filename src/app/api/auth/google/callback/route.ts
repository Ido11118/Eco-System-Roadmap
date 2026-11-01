import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/server/errors";
import { createSession } from "@/server/auth";
import { appUrl, finishGoogleFlow, GOOGLE_COOKIE, googleConfig, userForGoogle, type GoogleFlow } from "@/server/google";
import { clientIp, rateLimit } from "@/server/users";

// חזרה מ-Google: אימות state, החלפת הקוד בזהות, ויצירת סשן רגיל במערכת
export async function GET(req: NextRequest) {
  const base = appUrl();
  const fail = (msg: string, next?: string | null) => {
    const u = new URL("/login", base);
    u.searchParams.set("error", msg);
    if (next) u.searchParams.set("next", next);
    const res = NextResponse.redirect(u);
    res.cookies.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });
    return res;
  };
  let flow: GoogleFlow | null = null;
  try { flow = JSON.parse(req.cookies.get(GOOGLE_COOKIE)?.value ?? "null"); } catch { flow = null; }
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return fail(q.get("error") === "access_denied" ? "ההתחברות עם Google בוטלה" : "Google דחה את ההתחברות", flow?.next);
  const cfg = googleConfig();
  if (!cfg) return fail("התחברות עם Google אינה מוגדרת במערכת");
  if (!flow || !q.get("state") || q.get("state") !== flow.state || !q.get("code")) return fail("פג תוקף ההתחברות. נסה שוב.", flow?.next);
  try {
    rateLimit(`google:${clientIp(req.headers)}`, clientIp(req.headers) === "direct" ? 500 : 30);
    const id = await finishGoogleFlow(cfg, flow, q.get("code")!);
    const u = await userForGoogle(id);
    await createSession(u.id);
    const res = NextResponse.redirect(new URL(u.status === "APPROVED" ? flow.next ?? "/plan" : "/pending", base));
    res.cookies.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });
    return res;
  } catch (e) {
    if (!(e instanceof ApiError)) console.error(e);
    return fail(e instanceof ApiError ? e.message : "ההתחברות עם Google נכשלה. נסה שוב.", flow.next);
  }
}
