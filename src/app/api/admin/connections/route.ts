import { route } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { listAllConnections } from "@/server/oauth";
// ניהול מערכת: כל חיבורי ה-AI הפעילים (Claude / ChatGPT) של כל המשתמשים
export const GET = route(async () => listAllConnections(await requireSuper()));
