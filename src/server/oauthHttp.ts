import "server-only";
// עזרי HTTP לנקודות הקצה של OAuth: CORS (לקוחות מבוססי דפדפן), פענוח טפסים, ושגיאות בפורמט התקני
import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "./errors";
import { OAuthError } from "./oauth";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });

export function oauthJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } });
}

/** פרמטרים מגוף הבקשה: application/x-www-form-urlencoded (התקן) או JSON */
export async function formParams(req: NextRequest): Promise<Record<string, string | undefined>> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (type.includes("application/json")) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    } catch { throw new OAuthError(400, "invalid_request", "invalid JSON body"); }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** זיהוי לקוח בכותרת Authorization: Basic */
export function basicAuth(req: NextRequest): { id: string; secret: string } | null {
  const m = req.headers.get("authorization")?.match(/^Basic\s+(\S+)$/i);
  if (!m) return null;
  const raw = Buffer.from(m[1], "base64").toString("utf8");
  const i = raw.indexOf(":");
  if (i < 0) return null;
  try { return { id: decodeURIComponent(raw.slice(0, i)), secret: decodeURIComponent(raw.slice(i + 1)) }; }
  catch { throw new OAuthError(401, "invalid_client", "malformed Basic authorization header"); }
}

export function oauthHandler(fn: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest) => {
    try { return await fn(req); }
    catch (e) {
      if (e instanceof OAuthError) return oauthJson({ error: e.code, error_description: e.message }, e.status);
      if (e instanceof ApiError) return oauthJson({ error: e.status === 429 ? "temporarily_unavailable" : "invalid_request", error_description: e.message }, e.status);
      console.error(e);
      return oauthJson({ error: "server_error", error_description: "internal error" }, 500);
    }
  };
}
