import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { getMe } from "@/server/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { AuthShell } from "@/components/AuthShell";
import { RegisterForm } from "./RegisterForm";
export const dynamic = "force-dynamic";
export default async function RegisterPage() {
  const me = await getMe();
  if (me) redirect(me.status === "APPROVED" ? "/plan" : "/pending");
  const ds = await db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(asc(domains.sortOrder));
  return (
    <AuthShell title="הרשמה" subtitle="לאחר ההרשמה החשבון ימתין לאישור מנהל המערכת.">
      <RegisterForm domains={ds} />
    </AuthShell>
  );
}
