import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { getMe } from "@/server/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { AuthShell } from "@/components/AuthShell";
import { RegisterForm } from "./RegisterForm";
import { googleConfig } from "@/server/google";
export const dynamic = "force-dynamic";
export default async function RegisterPage() {
  const me = await getMe();
  if (me) redirect(me.status === "APPROVED" ? "/plan" : "/pending");
  const ds = await db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(asc(domains.sortOrder));
  return (
    <AuthShell title="הרשמה" subtitle="לאחר ההרשמה החשבון ימתין לאישור מנהל המערכת.">
      {googleConfig() && (
        <p className="mb-4 rounded-md bg-ink-50 px-3 py-2 text-[12.5px] text-ink-500">
          יש לך חשבון Google? אפשר פשוט <a href="/api/auth/google" className="font-medium text-brand-600 hover:underline">להתחבר עם Google</a> — החשבון ייווצר וימתין לאישור, בלי סיסמה נוספת.
        </p>
      )}
      <RegisterForm domains={ds} />
    </AuthShell>
  );
}
