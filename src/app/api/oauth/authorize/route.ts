import { z } from "zod";
import { route, body, ApiError } from "@/server/errors";
import { requireApproved } from "@/server/auth";
import { approve, redirectWith, validateAuthorize } from "@/server/oauth";

const schema = z.object({
  params: z.record(z.string().max(2000).optional()),
  decision: z.enum(["read", "write", "deny"]),
});

// החלטת המשתמש במסך האישור. הבקשה נבדקת שוב במלואה (לא סומכים על מה שהדפדפן שלח בעבר).
export const POST = route(async (req) => {
  const me = await requireApproved();
  const { params, decision } = schema.parse(await body(req));
  const v = await validateAuthorize(params);
  if (!v.ok) {
    if ("redirect" in v) return { redirect: v.redirect };
    throw new ApiError(400, v.message);
  }
  if (decision === "deny") return { redirect: redirectWith(v.req.redirectUri, { error: "access_denied", error_description: "the user denied access", state: v.req.state }) };
  return { redirect: await approve(me, v.req, decision) };
});
