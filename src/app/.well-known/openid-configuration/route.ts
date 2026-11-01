// חלק מהלקוחות מחפשים את הגדרות שרת ההרשאות בכתובת של OpenID — אותו מסמך
import { oauthJson, preflight } from "@/server/oauthHttp";
import { authorizationServerMetadata } from "@/server/oauth";
export const dynamic = "force-dynamic";
export const GET = async () => oauthJson(authorizationServerMetadata());
export const OPTIONS = preflight;
