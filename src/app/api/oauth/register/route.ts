// רישום לקוח אוטומטי (RFC 7591): Claude / ChatGPT נרשמים לבד בפעם הראשונה שמחברים אותם
import { oauthHandler, oauthJson, preflight } from "@/server/oauthHttp";
import { OAuthError, registerClient } from "@/server/oauth";
import { clientIp, rateLimit } from "@/server/users";
export const POST = oauthHandler(async (req) => {
  const ip = clientIp(req.headers);
  rateLimit(`oauth-reg:${ip}`, ip === "direct" ? 500 : 30);
  let body: unknown;
  try { body = await req.json(); } catch { throw new OAuthError(400, "invalid_client_metadata", "invalid JSON body"); }
  return oauthJson(await registerClient(body), 201);
});
export const OPTIONS = preflight;
