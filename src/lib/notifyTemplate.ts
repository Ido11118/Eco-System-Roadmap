// תבנית מייל התראה למנהל המערכת (פונקציה טהורה — נבדקת בבדיקות יחידה).
// כל ערך שמגיע מהמשתמש (שם, מייל, הערה) עובר escape — אחרת אפשר היה "להזריק" HTML למייל דרך שדה השם.

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type NotifyRow = { label: string; value: string };

export function adminNotifyHtml(o: { title: string; intro: string; rows: NotifyRow[]; ctaUrl: string; ctaLabel: string }): string {
  const rows = o.rows.filter((r) => r.value.trim())
    .map((r) => `<tr><td style="padding:6px 0 6px 16px;color:#64748b;white-space:nowrap;vertical-align:top">${esc(r.label)}</td><td style="padding:6px 0;color:#0f172a">${esc(r.value)}</td></tr>`)
    .join("");
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:520px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;direction:rtl;text-align:right">
  <div style="font-size:13px;color:#64748b;margin-bottom:6px">תוכנית עבודה · ניהול מערכת</div>
  <h1 style="font-size:18px;margin:0 0 8px;color:#0f172a">${esc(o.title)}</h1>
  <p style="font-size:14px;color:#334155;margin:0 0 14px">${esc(o.intro)}</p>
  <table style="font-size:14px;border-collapse:collapse;margin-bottom:18px">${rows}</table>
  <a href="${esc(o.ctaUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:bold">${esc(o.ctaLabel)}</a>
  <p style="font-size:12px;color:#94a3b8;margin:18px 0 0">המייל נשלח אוטומטית כי אתה מנהל המערכת.</p>
</div></body></html>`;
}
