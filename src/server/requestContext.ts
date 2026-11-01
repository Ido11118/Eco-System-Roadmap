import "server-only";
// הקשר הבקשה הנוכחית (AsyncLocalStorage): למשל — הפעולה מתבצעת דרך עוזר AI (MCP).
// audit() קורא ממנו ומסמן את הרשומה בהיסטוריה ("דרך Claude"), בלי להעביר פרמטר דרך כל הפונקציות.
import { AsyncLocalStorage } from "async_hooks";

export type RequestContext = { via?: string };
const als = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => als.run(ctx, fn);
export const currentVia = (): string | undefined => als.getStore()?.via;
