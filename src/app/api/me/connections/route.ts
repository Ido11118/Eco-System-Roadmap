import { route } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { listConnections, mcpUrl } from "@/server/oauth";
// חיבורי ה-AI של המשתמש + כתובת שרת ה-MCP להדבקה ב-Claude / ChatGPT
export const GET = route(async () => {
  const me = await requireApproved();
  return { mcpUrl: mcpUrl(), connections: await listConnections(me) };
});
