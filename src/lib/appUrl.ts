// הכתובת הציבורית של המערכת (APP_URL), מנורמלת — כל הכתובות שנשלחות החוצה נבנות ממנה
// (Google, Claude / ChatGPT, קישורי איפוס סיסמה ומיילים), ולכן טעות קטנה בהגדרה שוברת הכל.

/**
 * • בלי "/" בסוף.
 * • בלי פרוטוקול (טעות נפוצה בהגדרת המשתנה ב-Railway, למשל "my-app.up.railway.app") — משלימים https://
 *   (או http:// לכתובת מקומית: localhost / 127.0.0.1).
 * • לא הוגדר — http://localhost:3000.
 */
export function normalizeAppUrl(raw: string | undefined | null): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return "http://localhost:3000";
  if (/^https?:\/\//i.test(v)) return v;
  return `${/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(v) ? "http" : "https"}://${v}`;
}

export const appUrlFromEnv = () => normalizeAppUrl(process.env.APP_URL);
