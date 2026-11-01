// שרת ה-MCP (Streamable HTTP, ללא מצב): כל בקשה מזוהה לפי מפתח OAuth ומטופלת בנפרד.
// ללא מפתח תקף — 401 עם הפניה למסמך ההגדרות, וכך עוזר ה-AI יודע להתחיל את תהליך החיבור.
import { NextResponse, type NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateBearer } from "@/server/oauth";
import { appUrl } from "@/server/google";
import { buildMcpServer } from "@/server/mcp";
import { runWithContext } from "@/server/requestContext";
import { CORS, preflight } from "@/server/oauthHttp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unauthorized(error?: string) {
  const meta = `${appUrl()}/.well-known/oauth-protected-resource/api/mcp`;
  return NextResponse.json(
    { error: error ?? "unauthorized", error_description: "Connect this app via OAuth to use the work plan tools" },
    { status: 401, headers: { ...CORS, "WWW-Authenticate": `Bearer resource_metadata="${meta}"${error ? `, error="${error}"` : ""}` } },
  );
}

async function handle(req: NextRequest) {
  const header = req.headers.get("authorization");
  const auth = await authenticateBearer(header);
  if (!auth) return unauthorized(header ? "invalid_token" : undefined);
  // ללא מצב: שרת ותעבורה חדשים לכל בקשה, עם הכלים המותרים לחיבור הזה
  const server = buildMcpServer({ me: auth.me, access: auth.access, clientName: auth.clientName });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await runWithContext({ via: auth.clientName.slice(0, 40) }, () => transport.handleRequest(req, {
      authInfo: { token: auth.token, clientId: String(auth.grantId), scopes: auth.access === "write" ? ["plan:read", "plan:write"] : ["plan:read"], expiresAt: auth.expiresAt },
    }));
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  } finally {
    await server.close().catch(() => {});
  }
}

export const POST = handle;
// ללא מצב — אין ערוץ SSE פתוח ואין סשן למחוק
export const GET = async (req: NextRequest) => {
  if (!(await authenticateBearer(req.headers.get("authorization")))) return unauthorized();
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405, headers: { ...CORS, Allow: "POST" } });
};
export const DELETE = GET;
export const OPTIONS = preflight;
