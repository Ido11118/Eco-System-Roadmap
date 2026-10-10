import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

/** הכתובת הציבורית של המערכת (APP_URL) — מקור מורשה גם כשה-Reverse Proxy משנה את כותרת Host */
function appHost(): string | null {
  try { return process.env.APP_URL ? new URL(process.env.APP_URL).host : null; } catch { return null; }
}

/** בדיקת מקור הבקשה לפעולות משנות (הגנת CSRF בנוסף ל-SameSite) */
function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // בקשות שאינן מדפדפן (למשל curl) — נדרשת עדיין עוגיית סשן
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { throw new ApiError(403, "מקור הבקשה אינו מורשה"); }
  const allowed = [appHost(), req.headers.get("x-forwarded-host"), req.headers.get("host")];
  if (!allowed.includes(originHost)) throw new ApiError(403, "מקור הבקשה אינו מורשה");
}

type Ctx = { params: Promise<Record<string, string>> };

export function route(handler: (req: NextRequest, ctx: Ctx) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      checkOrigin(req);
      const out = await handler(req, ctx);
      if (out instanceof NextResponse || out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: e.message, data: e.data }, { status: e.status });
      }
      if (e instanceof ZodError) {
        const msg = e.issues[0]?.message ?? "נתונים לא תקינים";
        return NextResponse.json({ error: msg, issues: e.issues }, { status: 400 });
      }
      const pgCode = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
      if (pgCode === "23514") return NextResponse.json({ error: "הנתונים אינם עומדים בכללי התקינות" }, { status: 400 });
      if (pgCode === "23505") return NextResponse.json({ error: "הרשומה כבר קיימת" }, { status: 409 });
      if (pgCode === "23503") return NextResponse.json({ error: "הפניה לרשומה שאינה קיימת" }, { status: 400 });
      if (pgCode === "23P01") return NextResponse.json({ error: "הטווח חופף לתכולה אחרת באותה שורה", data: { conflict: "overlap" } }, { status: 409 });
      if (pgCode === "40P01" || pgCode === "40001") return NextResponse.json({ error: "התנגשות עם עדכון מקביל. נסה שוב.", data: { conflict: "version" } }, { status: 409 });
      console.error(e);
      return NextResponse.json({ error: "שגיאת שרת. נסה שוב." }, { status: 500 });
    }
  };
}

export async function body(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "גוף הבקשה אינו תקין");
  }
}

export function intParam(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, "מזהה לא תקין");
  return n;
}
