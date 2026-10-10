import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
// בדיקת תקינות לניטור / Docker healthcheck: השרת חי ובסיס הנתונים זמין. אינה חושפת מידע.
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
