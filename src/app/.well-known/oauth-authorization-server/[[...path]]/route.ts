// מסמך שרת ההרשאות (RFC 8414): כתובות האישור, המפתחות והרישום
import { oauthJson, preflight } from "@/server/oauthHttp";
import { authorizationServerMetadata } from "@/server/oauth";
export const dynamic = "force-dynamic";
export const GET = async () => oauthJson(authorizationServerMetadata());
export const OPTIONS = preflight;
