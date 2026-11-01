import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_COOKIE, googleConfig, safeNext, startGoogleFlow } from "@/server/google";
import { secureCookies } from "@/server/auth";

// התחלת התחברות עם Google: שמירת state / PKCE / nonce בעוגייה קצרת-מועד, והפניה ל-Google
export async function GET(req: NextRequest) {
  const cfg = googleConfig();
  if (!cfg) return NextResponse.redirect(new URL("/login?error=google_off", req.nextUrl.origin));
  const { url, flow } = startGoogleFlow(cfg, safeNext(req.nextUrl.searchParams.get("next")));
  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_COOKIE, JSON.stringify(flow), {
    httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/api/auth/google", maxAge: 600,
  });
  return res;
}
