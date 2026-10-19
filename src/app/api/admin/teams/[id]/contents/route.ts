import { route, intParam } from "@/server/errors";
import { requireSuper } from "@/server/auth";
import { teamContents } from "@/server/structure";
export const GET = route(async (_req, ctx) => teamContents(await requireSuper(), intParam((await ctx.params).id)));
