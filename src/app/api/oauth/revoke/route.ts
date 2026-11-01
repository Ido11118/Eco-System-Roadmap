// ביטול מפתח (RFC 7009) — מנתק את החיבור. תמיד מחזיר 200 (גם למפתח לא מוכר), לפי התקן.
import { NextResponse } from "next/server";
import { basicAuth, CORS, formParams, oauthHandler, preflight } from "@/server/oauthHttp";
import { revokeToken } from "@/server/oauth";
export const POST = oauthHandler(async (req) => {
  await revokeToken(await formParams(req), basicAuth(req));
  return new NextResponse(null, { status: 200, headers: CORS });
});
export const OPTIONS = preflight;
