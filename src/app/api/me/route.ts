import { route, ApiError } from "@/server/errors";
import { getMe } from "@/server/auth";
export const GET = route(async () => {
  const me = await getMe();
  if (!me) throw new ApiError(401, "נדרשת התחברות");
  return me;
});
