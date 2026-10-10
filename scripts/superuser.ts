import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../src/db";
import { users, sessions, passwordResetTokens, userDomainPermissions, approvalRequests, auditLogs } from "../src/db/schema";

// Bootstrap מאובטח: פרטי המנהל מגיעים ממשתני סביבה בלבד, לא מהקוד.
export async function ensureSuperUser() {
  const email = process.env.SUPERUSER_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERUSER_PASSWORD;
  const name = process.env.SUPERUSER_NAME || "מנהל המערכת";
  if (!email || !password) {
    console.log("! SUPERUSER_EMAIL / SUPERUSER_PASSWORD not set — skipping super user bootstrap");
    return;
  }
  if (password.length < 10) throw new Error("SUPERUSER_PASSWORD must be at least 10 characters");
  const [existingSuper] = await db.select().from(users).where(eq(users.role, "SUPER"));
  if (existingSuper) {
    console.log(`✓ super user already exists (${existingSuper.email}) — not modified`);
    return;
  }
  const [byEmail] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  const passwordHash = await bcrypt.hash(password, 12);
  if (byEmail) {
    // ייתכן שמישהו נרשם מראש עם כתובת המנהל: מנתקים את כל הסשנים שלו, מוחקים הרשאות ובקשות,
    // ורק אז מקדמים — כך שאיש לא מחזיק סשן פעיל שהפך לסשן של Super User.
    await db.transaction(async (tx) => {
      await tx.delete(sessions).where(eq(sessions.userId, byEmail.id));
      await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, byEmail.id));
      await tx.delete(userDomainPermissions).where(eq(userDomainPermissions.userId, byEmail.id));
      await tx.delete(approvalRequests).where(eq(approvalRequests.userId, byEmail.id));
      await tx.update(users).set({ role: "SUPER", status: "APPROVED", canEditCross: true, passwordHash, fullName: name, approvedAt: new Date() })
        .where(eq(users.id, byEmail.id));
      await tx.insert(auditLogs).values({ userId: null, entityType: "user", entityId: String(byEmail.id), action: "bootstrapSuper",
        summary: "חשבון קיים הוגדר כ-Super User בתהליך האתחול (סשנים והרשאות קודמים בוטלו)" });
    });
    console.log(`! existing account ${email} was promoted to super user; its previous sessions were revoked`);
  } else {
    await db.insert(users).values({ email, fullName: name, passwordHash, role: "SUPER", status: "APPROVED", canEditCross: true, approvedAt: new Date() });
  }
  console.log(`✓ super user created: ${email}`);
}
