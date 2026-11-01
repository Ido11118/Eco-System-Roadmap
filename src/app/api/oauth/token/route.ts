// הנפקת מפתחות: החלפת קוד חד-פעמי (עם PKCE) או מפתח חידוש
import { basicAuth, formParams, oauthHandler, oauthJson, preflight } from "@/server/oauthHttp";
import { tokenRequest } from "@/server/oauth";
import { clientIp, rateLimit } from "@/server/users";
export const POST = oauthHandler(async (req) => {
  const ip = clientIp(req.headers);
  rateLimit(`oauth-token:${ip}`, ip === "direct" ? 5000 : 300);
  return oauthJson(await tokenRequest(await formParams(req), basicAuth(req)));
});
export const OPTIONS = preflight;
