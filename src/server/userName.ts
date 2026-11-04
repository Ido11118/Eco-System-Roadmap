import "server-only";
// שם המשתמש לתצוגה (היסטוריה, תמונות מצב, תכולות שנמחקו): משתמש קיים — שמו; משתמש שנמחק לצמיתות — שמו מ-deleted_users עם "(נמחק)".
// משמש עם leftJoin(users, eq(users.id, col)) קיים.
import { sql, type AnyColumn } from "drizzle-orm";
import { deletedUsers, users } from "@/db/schema";

export const displayName = (col: AnyColumn) =>
  sql<string | null>`coalesce(${users.fullName}, (select ${deletedUsers.fullName} || ' (נמחק)' from ${deletedUsers} where ${deletedUsers.id} = ${col}))`;
