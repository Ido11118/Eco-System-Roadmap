// מסמך המשאב המוגן (RFC 9728): שרת ה-MCP ומי מנפיק לו מפתחות. גם בנתיב עם סיומת (…/api/mcp) לפי התקן.
import { oauthJson, preflight } from "@/server/oauthHttp";
import { protectedResourceMetadata } from "@/server/oauth";
export const dynamic = "force-dynamic";
export const GET = async () => oauthJson(protectedResourceMetadata());
export const OPTIONS = preflight;
