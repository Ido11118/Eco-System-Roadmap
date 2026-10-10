/* eslint-disable no-console */
// בדיקות קצה-לקצה: 25 התרחישים המחייבים (סעיף 22 באפיון) ובדיקות קשיחות נוספות (מקביליות, קלט זדוני, אבטחה).
// הרצה מול שרת רץ: BASE_URL=http://localhost:3000 SUPERUSER_EMAIL=... SUPERUSER_PASSWORD=... npm run test:e2e
// מומלץ להריץ מול בסיס נתונים ייעודי לבדיקות — הבדיקות יוצרות משתמשים ותכולות.
import { chromium, request, type APIRequestContext, type Browser, type Page } from "playwright";
import { addWeeks, currentWeekIL, weekNumber } from "../../src/lib/weeks";
import type { ItemDTO, PlanData, RowDTO } from "../../src/lib/types";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = { email: process.env.SUPERUSER_EMAIL ?? "admin@example.org", password: process.env.SUPERUSER_PASSWORD ?? "ChangeMe-Admin-2026!" };
const SHOTS = process.env.SHOTS_DIR;
const CHROME = process.env.CHROME_PATH;
const RUN = Date.now().toString(36);
const PW = "Test-Password-123";

const results: { n: number; name: string; ok: boolean; err?: string }[] = [];
async function scenario(n: number, name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ n, name, ok: true }); console.log(`✓ ${n}. ${name}`); }
  catch (e) { results.push({ n, name, ok: false, err: (e as Error).message }); console.log(`✗ ${n}. ${name}\n    ${(e as Error).message}`); }
}
function assert(c: unknown, msg: string): asserts c { if (!c) throw new Error(msg); }

async function ctx(): Promise<APIRequestContext> { return request.newContext({ baseURL: BASE }); }
async function login(c: APIRequestContext, email: string, password: string) {
  const r = await c.post("/api/auth/login", { data: { email, password } });
  assert(r.ok(), `login failed ${email}: ${r.status()} ${await r.text()}`);
}
async function json<T>(c: APIRequestContext, method: string, url: string, data?: unknown): Promise<{ status: number; body: T }> {
  const r = await c.fetch(url, { method, data });
  return { status: r.status(), body: (await r.json().catch(() => ({}))) as T };
}
async function uiLogin(b: Browser, email: string, password: string): Promise<Page> {
  const context = await b.newContext({ viewport: { width: 1600, height: 950 }, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  const p = await context.newPage();
  p.on("pageerror", (e) => console.log("    [pageerror]", e.message));
  await p.goto(`${BASE}/login`);
  await p.fill("#email", email);
  await p.fill("#password", password);
  await p.click("form button.btn-primary");
  await p.waitForURL(/\/(plan|pending)/, { timeout: 60000 });
  return p;
}
async function shot(p: Page, name: string) { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); }

async function main() {
  const admin = await ctx();
  await login(admin, ADMIN.email, ADMIN.password);
  const plan0 = (await json<PlanData>(admin, "GET", "/api/plan")).body;
  const AGAM = plan0.domains.find((d) => d.key === "agam")!.id;
  const ESH = plan0.domains.find((d) => d.key === "esh")!.id;
  const T_AZ1 = plan0.teams.find((t) => t.key === "azarim-1")!.id;
  const T_SYS = plan0.teams.find((t) => t.key === "sysadmin")!.id;
  const T_ESH = plan0.teams.find((t) => t.key === "attack-exposure")!.id;
  const cw = currentWeekIL();
  const newRow = async (c: APIRequestContext, teamId: number) => (await json<RowDTO>(c, "POST", "/api/rows", { teamId })).body;
  const uA = { email: `a-${RUN}@test.local`, name: "משתמש א" };
  const uB = { email: `b-${RUN}@test.local`, name: "משתמש ב" };
  const uC = { email: `c-${RUN}@test.local`, name: "משתמש ג" };
  const A = await ctx(), B = await ctx(), C = await ctx(), P = await ctx();
  const userId = async (email: string) => ((await json<{ id: number; email: string }[]>(admin, "GET", "/api/admin/users")).body).find((u) => u.email === email)!.id;

  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

  // 1 ---------------------------------------------------------------
  await scenario(1, "משתמש חדש נרשם וממתין לאישור", async () => {
    const r = await json<{ status: string }>(A, "POST", "/api/auth/register", { fullName: uA.name, email: uA.email, password: PW, domainIds: [AGAM], requestCross: false });
    assert(r.status === 200 && r.body.status === "PENDING", `register: ${r.status} ${JSON.stringify(r.body)}`);
    const me = await json<{ status: string }>(A, "GET", "/api/me");
    assert(me.body.status === "PENDING", "status should be PENDING");
    const p = await uiLogin(browser, uA.email, PW);
    assert(p.url().includes("/pending"), `expected /pending, got ${p.url()}`);
    assert(await p.getByText("ממתין לאישור מנהל המערכת").isVisible(), "pending message not shown");
    await p.goto(`${BASE}/plan`);
    assert(p.url().includes("/pending"), "pending user reached /plan");
    await shot(p, "01-pending");
    await p.context().close();
  });

  // 2 ---------------------------------------------------------------
  await scenario(2, "משתמש ממתין אינו יכול לצפות בנתונים גם באמצעות API", async () => {
    for (const [m, u, d] of [["GET", "/api/plan"], ["GET", "/api/snapshots"], ["GET", "/api/views"], ["GET", "/api/history?type=item&id=1"], ["POST", "/api/items", { rowId: 1, name: "x", startWeek: cw, endWeek: cw }]] as const) {
      const r = await json(A, m, u, d);
      assert(r.status === 403, `${m} ${u} returned ${r.status}`);
    }
    const anon = await json(P, "GET", "/api/plan");
    assert(anon.status === 401, `anonymous got ${anon.status}`);
  });

  // 3 ---------------------------------------------------------------
  await scenario(3, "Super User מאשר משתמש ונותן לו הרשאה לתחום אחד", async () => {
    const pending = (await json<{ id: number; email: string; status: string; request: { domainIds: number[] } }[]>(admin, "GET", "/api/admin/users")).body.find((u) => u.email === uA.email)!;
    assert(pending.status === "PENDING" && pending.request.domainIds.includes(AGAM), "request not visible to admin");
    const r = await json(admin, "POST", `/api/admin/users/${pending.id}`, { action: "approve", domainIds: [AGAM], canEditCross: false });
    assert(r.status === 200, `approve ${r.status}`);
    const me = (await json<{ status: string; domainIds: number[] }>(A, "GET", "/api/me")).body;
    assert(me.status === "APPROVED" && me.domainIds.length === 1 && me.domainIds[0] === AGAM, `me ${JSON.stringify(me)}`);
    assert((await json(A, "GET", "/api/plan")).status === 200, "approved user cannot read plan");
  });

  let itemA: ItemDTO;
  // 4 ---------------------------------------------------------------
  await scenario(4, "המשתמש יכול לערוך את התחום המורשה אך לא תחום אחר", async () => {
    const rAz = (await newRow(A, T_AZ1));
    assert(rAz.id, "could not add row in permitted domain");
    const ok = await json<ItemDTO>(A, "POST", "/api/items", { rowId: rAz.id, name: `בדיקה ${RUN}`, startWeek: cw, endWeek: addWeeks(cw, 1) });
    assert(ok.status === 200, `create in agam: ${ok.status} ${JSON.stringify(ok.body)}`);
    itemA = ok.body;
    const eshRow = plan0.rows.find((r) => r.teamId === T_ESH)!;
    const bad = await json(A, "POST", "/api/items", { rowId: eshRow.id, name: "x", startWeek: addWeeks(cw, 30), endWeek: addWeeks(cw, 30) });
    assert(bad.status === 403, `create in esh returned ${bad.status}`);
    const eshItem = plan0.items.find((i) => i.teamId === T_ESH);
    if (eshItem) {
      const u = await json(A, "PATCH", `/api/items/${eshItem.id}`, { version: eshItem.version, patch: { name: "hack" } });
      assert(u.status === 403, `update in esh returned ${u.status}`);
      const d = await json(A, "DELETE", `/api/items/${eshItem.id}`);
      assert(d.status === 403, `delete in esh returned ${d.status}`);
    }
    const crossRow = plan0.rows.find((r) => r.kind === "INFLUENCE")!;
    const cr = await json(A, "POST", "/api/items", { rowId: crossRow.id, name: "x", startWeek: cw, endWeek: cw });
    assert(cr.status === 403, `cross edit without permission returned ${cr.status}`);
    const ms = await json(A, "POST", "/api/milestones", { name: "x", date: cw, teamId: null });
    assert(ms.status === 403, `cross milestone returned ${ms.status}`);
    // העברה לתחום לא מורשה
    const mv = await json(A, "PATCH", `/api/items/${itemA.id}`, { version: itemA.version, patch: { rowId: eshRow.id } });
    assert(mv.status === 403, `move to esh returned ${mv.status}`);
  });

  // 5 ---------------------------------------------------------------
  await scenario(5, "משתמש עם מספר הרשאות יכול לערוך מספר תחומים", async () => {
    await json(B, "POST", "/api/auth/register", { fullName: uB.name, email: uB.email, password: PW, domainIds: [AGAM, ESH], requestCross: false });
    await json(admin, "POST", `/api/admin/users/${await userId(uB.email)}`, { action: "approve", domainIds: [AGAM, ESH], canEditCross: false });
    const r1 = await newRow(B, T_AZ1), r2 = await newRow(B, T_ESH);
    const a = await json(B, "POST", "/api/items", { rowId: r1.id, name: "B-agam", startWeek: cw, endWeek: cw });
    const e = await json(B, "POST", "/api/items", { rowId: r2.id, name: "B-esh", startWeek: cw, endWeek: cw });
    assert(a.status === 200 && e.status === 200, `B: ${a.status}/${e.status}`);
    const tRow = plan0.rows.find((r) => r.teamId === plan0.teams.find((t) => t.key === "control")!.id)!;
    const x = await json(B, "POST", "/api/items", { rowId: tRow.id, name: "B-tikshuv", startWeek: addWeeks(cw, 40), endWeek: addWeeks(cw, 40) });
    assert(x.status === 403, "B edited a domain without permission");
  });

  // 6 ---------------------------------------------------------------
  await scenario(6, "משתמש עם כל הרשאות העריכה אינו יכול לגשת לניהול משתמשים", async () => {
    await json(C, "POST", "/api/auth/register", { fullName: uC.name, email: uC.email, password: PW, domainIds: [], requestCross: true });
    await json(admin, "POST", `/api/admin/users/${await userId(uC.email)}`, { action: "approve", domainIds: plan0.domains.map((d) => d.id), canEditCross: true });
    assert((await json(C, "GET", "/api/admin/users")).status === 403, "C can list users");
    assert((await json(C, "POST", `/api/admin/users/${await userId(uA.email)}`, { action: "suspend" })).status === 403, "C can manage users");
    assert((await json(C, "GET", "/api/admin/audit")).status === 403, "C can read admin audit");
    assert((await json(C, "POST", "/api/snapshots", { name: "x" })).status === 403, "C can create snapshot");
    const crossRow = plan0.rows.find((r) => r.kind === "CROSS_EVENT")!;
    assert((await json(C, "POST", "/api/items", { rowId: crossRow.id, name: `C-cross-${RUN}`, startWeek: addWeeks(cw, 50), endWeek: addWeeks(cw, 50) })).status === 200, "C cannot edit cross");
    const p = await uiLogin(browser, uC.email, PW);
    assert(!(await p.locator("[data-testid=nav-admin]").count()), "admin link visible to C");
    await p.goto(`${BASE}/admin`);
    assert(!p.url().includes("/admin"), "C reached /admin page");
    await p.context().close();
  });

  // UI session for user A
  const pa = await uiLogin(browser, uA.email, PW);
  await pa.waitForSelector("[data-testid=gantt-view]");
  const freeRow = await newRow(A, T_AZ1);
  await pa.reload();
  await pa.waitForSelector(`[data-lane-row="${freeRow.id}"]`);

  const laneBox = async (p: Page, rowId: number) => (await p.locator(`[data-lane-row="${rowId}"]`).first().boundingBox())!;
  const weekCenterX = async (p: Page, sunday: string) => { const b = (await p.locator(`[data-week="${sunday}"]`).boundingBox())!; return b.x + b.width / 2; };

  // 7 ---------------------------------------------------------------
  let created7: ItemDTO | undefined;
  await scenario(7, "הוספת תכולה באמצעות סימון טווח בגאנט", async () => {
    const lb = await laneBox(pa, freeRow.id);
    const y = lb.y + lb.height / 2;
    const x1 = await weekCenterX(pa, cw), x2 = await weekCenterX(pa, addWeeks(cw, 2));
    await pa.mouse.move(x1, y); await pa.mouse.down(); await pa.mouse.move((x1 + x2) / 2, y, { steps: 4 }); await pa.mouse.move(x2, y, { steps: 4 }); await pa.mouse.up();
    await pa.waitForSelector("[data-testid=quick-create]");
    await shot(pa, "07-quick-create");
    await pa.fill("[data-testid=quick-name]", `סימון טווח ${RUN}`);
    await pa.keyboard.press("Enter");
    await pa.waitForTimeout(800);
    const plan = (await json<PlanData>(A, "GET", "/api/plan")).body;
    created7 = plan.items.find((i) => i.name === `סימון טווח ${RUN}`);
    assert(created7, "item not created");
    assert(created7.rowId === freeRow.id && created7.startWeek === cw && created7.endWeek === addWeeks(cw, 2), `wrong placement ${JSON.stringify(created7)}`);
    assert(await pa.locator(`[data-bar="${created7.id}"]`).count() === 1, "bar not rendered");
  });

  // 8 ---------------------------------------------------------------
  await scenario(8, "הוספת תכולה דרך כפתור", async () => {
    await pa.click("[data-testid=add-item]");
    await pa.fill("#ni-name", `כפתור ${RUN}`);
    await pa.selectOption("[data-testid=target-select]", `team:${T_SYS}`);
    await shot(pa, "08-add-dialog");
    await pa.click("form#new-item-form ~ * button.btn-primary, div[role=dialog] button.btn-primary");
    await pa.waitForTimeout(800);
    const plan = (await json<PlanData>(A, "GET", "/api/plan")).body;
    const it = plan.items.find((i) => i.name === `כפתור ${RUN}`);
    assert(it && it.teamId === T_SYS, "item via dialog not created");
  });

  // 9 ---------------------------------------------------------------
  await scenario(9, "שינוי סטטוס בטבלת התכולות משנה את צבע הקובייה בגאנט", async () => {
    assert(created7, "prereq");
    await pa.click("[data-testid=mode-table]");
    await pa.waitForSelector(`[data-testid=status-${created7.id}]`);
    await pa.selectOption(`[data-testid=status-${created7.id}]`, "BLOCKED");
    await pa.waitForTimeout(600);
    await shot(pa, "09-table");
    await pa.click("[data-testid=mode-gantt]");
    const bg = await pa.locator(`[data-bar="${created7.id}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(bg === "rgb(220, 38, 38)", `bar color is ${bg}`);
    const srv = (await json<PlanData>(A, "GET", "/api/plan")).body.items.find((i) => i.id === created7!.id)!;
    assert(srv.status === "BLOCKED", "status not persisted");
  });

  // 10 --------------------------------------------------------------
  await scenario(10, "שינוי טווח זמן בגאנט (גרירה) מעדכן את טבלת התכולות", async () => {
    assert(created7, "prereq");
    const bar = pa.locator(`[data-bar="${created7.id}"]`);
    const bb = (await bar.boundingBox())!;
    const wb = (await pa.locator(`[data-week="${cw}"]`).boundingBox())!;
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    await pa.mouse.move(cx, cy); await pa.mouse.down();
    await pa.mouse.move(cx - wb.width, cy, { steps: 5 }); await pa.mouse.move(cx - wb.width * 2, cy, { steps: 5 });
    await shot(pa, "10-drag");
    await pa.mouse.up();
    await pa.waitForTimeout(900);
    const srv = (await json<PlanData>(A, "GET", "/api/plan")).body.items.find((i) => i.id === created7!.id)!;
    assert(srv.startWeek === addWeeks(cw, 2) && srv.endWeek === addWeeks(cw, 4), `after drag: ${srv.startWeek}..${srv.endWeek}`);
    await pa.click("[data-testid=mode-table]");
    const rowText = await pa.locator(`[data-item-row="${created7.id}"]`).innerText();
    assert(rowText.includes(`שבוע ${weekNumber(addWeeks(cw, 2))}`) && rowText.includes(`שבוע ${weekNumber(addWeeks(cw, 4))}`), `table row: ${rowText}`);
    await pa.click("[data-testid=mode-gantt]");
    created7 = srv;
  });

  // 11 --------------------------------------------------------------
  await scenario(11, "הוספה ומחיקה של שורות עובדות לפי הכללים", async () => {
    const before = (await json<PlanData>(A, "GET", "/api/plan")).body.rows.filter((r) => r.teamId === T_AZ1).length;
    await pa.locator(`[data-testid=row-menu-${freeRow.id}]`).click({ force: true });
    const add = pa.waitForResponse((r) => r.url().endsWith("/api/rows") && r.request().method() === "POST");
    await pa.getByText("הוסף שורה מתחת").click();
    await add;
    const plan = (await json<PlanData>(A, "GET", "/api/plan")).body;
    const rows = plan.rows.filter((r) => r.teamId === T_AZ1).sort((a, b) => a.sortOrder - b.sortOrder);
    assert(rows.length === before + 1, `rows ${before} → ${rows.length}`);
    const idx = rows.findIndex((r) => r.id === freeRow.id);
    const added = rows[idx + 1];
    assert(added && !plan.items.some((i) => i.rowId === added.id), "new row not placed directly below");
    await pa.waitForSelector(`[data-testid=row-menu-${added.id}]`);
    await pa.locator(`[data-testid=row-menu-${added.id}]`).click({ force: true });
    const del = pa.waitForResponse((r) => r.url().includes(`/api/rows/${added.id}`) && r.request().method() === "DELETE", { timeout: 5000 }).catch(() => null);
    await pa.getByText("מחיקת שורה").click();
    assert(await del, "no DELETE request sent (confirm dialog shown for empty row?)");
    assert(!(await pa.locator("div[role=dialog]").count()), "confirm dialog shown for empty row");
    const after = (await json<PlanData>(A, "GET", "/api/plan")).body.rows.filter((r) => r.teamId === T_AZ1).length;
    assert(after === before, "empty row not deleted immediately");
    // ללא הרשאה: אין אפשרות להוסיף שורה בתחום אחר
    assert((await json(A, "POST", "/api/rows", { teamId: T_ESH })).status === 403, "row added in unauthorized team");
  });

  // 12 --------------------------------------------------------------
  await scenario(12, "מחיקת שורה עם תוכן מחייבת אישור", async () => {
    await pa.locator(`[data-testid=row-menu-${freeRow.id}]`).click({ force: true });
    await pa.getByText("מחיקת שורה").click();
    const dlg = pa.locator("div[role=dialog]");
    await dlg.waitFor();
    assert((await dlg.innerText()).includes("שים לב, בשורה זו קיים תוכן"), "wrong dialog text");
    await shot(pa, "12-delete-confirm");
    await dlg.getByRole("button", { name: "ביטול" }).click();
    await pa.waitForTimeout(300);
    const plan = (await json<PlanData>(A, "GET", "/api/plan")).body;
    assert(plan.rows.some((r) => r.id === freeRow.id), "row deleted despite cancel");
    // אישור מחיקה דרך API ושחזור (Undo / Soft Delete)
    const tmp = await newRow(A, T_AZ1);
    const it = (await json<ItemDTO>(A, "POST", "/api/items", { rowId: tmp.id, name: "למחיקה", startWeek: cw, endWeek: cw })).body;
    assert((await json(A, "DELETE", `/api/rows/${tmp.id}`)).status === 200, "delete row failed");
    let p2 = (await json<PlanData>(A, "GET", "/api/plan")).body;
    assert(!p2.items.some((i) => i.id === it.id), "items of deleted row still active");
    assert((await json(A, "POST", `/api/rows/${tmp.id}/restore`)).status === 200, "restore failed");
    p2 = (await json<PlanData>(A, "GET", "/api/plan")).body;
    assert(p2.items.some((i) => i.id === it.id), "undo did not restore row content");
    await json(A, "DELETE", `/api/rows/${tmp.id}`);
  });

  // 13 --------------------------------------------------------------
  // הכנת תרחיש השוואה: שתי תכולות באותה שורה שיחפפו בין תכנון לביצוע לאחר השינוי
  const cmpRow = await newRow(admin, T_SYS);
  const X1 = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: cmpRow.id, name: `X1-${RUN}`, startWeek: addWeeks(cw, 2), endWeek: addWeeks(cw, 5) })).body;
  const X2 = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: cmpRow.id, name: `X2-${RUN}`, startWeek: addWeeks(cw, 6), endWeek: addWeeks(cw, 9) })).body;
  let snapId = 0;
  await scenario(13, "יצירת Snapshot אינה משנה את התוכנית הנוכחית", async () => {
    const before = (await json<PlanData>(admin, "GET", "/api/plan")).body;
    const r = await json<{ id: number }>(admin, "POST", "/api/snapshots", { name: `בדיקה ${RUN}`, description: "e2e" });
    assert(r.status === 200, `create snapshot ${r.status}`);
    snapId = r.body.id;
    const after = (await json<PlanData>(admin, "GET", "/api/plan")).body;
    assert(JSON.stringify(before.items) === JSON.stringify(after.items) && JSON.stringify(before.rows) === JSON.stringify(after.rows), "plan changed");
    const snap = (await json<{ data: PlanData }>(admin, "GET", `/api/snapshots/${snapId}`)).body.data;
    assert(snap.items.length === after.items.length && snap.domains.length === after.domains.length, "snapshot content incomplete");
    // שינוי בתוכנית אינו משנה את ה-Snapshot
    // X2 קודם — כדי שלא תיווצר חפיפה אמיתית בשורה
    assert((await json(admin, "PATCH", `/api/items/${X2.id}`, { version: X2.version, patch: { startWeek: addWeeks(cw, 8), endWeek: addWeeks(cw, 11) } })).status === 200, "move X2 failed");
    assert((await json(admin, "PATCH", `/api/items/${X1.id}`, { version: X1.version, patch: { startWeek: addWeeks(cw, 4), endWeek: addWeeks(cw, 7) } })).status === 200, "move X1 failed");
    const snap2 = (await json<{ data: PlanData }>(admin, "GET", `/api/snapshots/${snapId}`)).body.data;
    assert(snap2.items.find((i) => i.id === X1.id)!.startWeek === addWeeks(cw, 2), "snapshot mutated by live edit");
  });

  // 14 --------------------------------------------------------------
  await scenario(14, "משתמש רגיל יכול לצפות ב-Snapshot אך לא לערוך אותו", async () => {
    const g = await json<{ data: PlanData; revision: { id: number } }>(A, "GET", `/api/snapshots/${snapId}`);
    assert(g.status === 200, "cannot view snapshot");
    const w = await json(C, "POST", `/api/snapshots/${snapId}/revisions`, { baseRevisionId: g.body.revision.id, note: "x", data: g.body.data });
    assert(w.status === 403, `C revised snapshot: ${w.status}`);
    assert((await json(C, "PATCH", `/api/snapshots/${snapId}`, { name: "x" })).status === 403, "C renamed snapshot");
    assert((await json(A, "DELETE", `/api/snapshots/${snapId}`)).status === 403, "A deleted snapshot");
    await pa.goto(`${BASE}/plan?snap=${snapId}`);
    await pa.waitForSelector("[data-testid=snapshot-banner]");
    await pa.waitForSelector(`[data-bar="${X1.id}"]`);
    assert(!(await pa.locator("[data-testid=add-item]").count()), "add button visible in snapshot view");
    assert(!(await pa.locator("[data-testid^=row-menu-]").count()), "row menus visible in snapshot view");
    await shot(pa, "14-snapshot-view");
  });

  // 15 --------------------------------------------------------------
  await scenario(15, "עריכת Snapshot על ידי Super User שומרת Revision קודם", async () => {
    const g = (await json<{ data: PlanData; revision: { id: number; revisionNo: number } }>(admin, "GET", `/api/snapshots/${snapId}`)).body;
    const data = structuredClone(g.data);
    data.items.find((i) => i.id === X1.id)!.name = `X1-ערוך-${RUN}`;
    data.items.push({ ...data.items.find((i) => i.id === X1.id)!, id: -1, name: "נוסף בעריכה", startWeek: addWeeks(cw, 30), endWeek: addWeeks(cw, 30) });
    const r = await json<{ revisionNo: number }>(admin, "POST", `/api/snapshots/${snapId}/revisions`, { baseRevisionId: g.revision.id, note: "תיקון", data });
    assert(r.status === 200 && r.body.revisionNo === 2, `revise: ${r.status} ${JSON.stringify(r.body)}`);
    const stale = await json(admin, "POST", `/api/snapshots/${snapId}/revisions`, { baseRevisionId: g.revision.id, note: "stale", data });
    assert(stale.status === 409, "stale revision accepted");
    const old = (await json<{ data: PlanData }>(admin, "GET", `/api/snapshots/${snapId}?rev=${g.revision.id}`)).body.data;
    assert(old.items.find((i) => i.id === X1.id)!.name === `X1-${RUN}`, "revision 1 changed");
    const cur = (await json<{ data: PlanData }>(admin, "GET", `/api/snapshots/${snapId}`)).body.data;
    assert(cur.items.find((i) => i.id === X1.id)!.name === `X1-ערוך-${RUN}`, "current revision not updated");
    assert(cur.items.every((i) => i.id > 0), "new item did not receive a permanent ID");
    const revs = (await json<unknown[]>(admin, "GET", `/api/snapshots/${snapId}/revisions`)).body;
    assert(revs.length === 2, "revision history wrong");
    // שחזור גרסה 1 → גרסה 3 עם התוכן המקורי
    const rr = await json<{ revisionNo: number }>(admin, "POST", `/api/snapshots/${snapId}/restore`, { revisionId: g.revision.id });
    assert(rr.body.revisionNo === 3, "restore did not create revision 3");
    const cur3 = (await json<{ data: PlanData }>(admin, "GET", `/api/snapshots/${snapId}`)).body.data;
    assert(cur3.items.find((i) => i.id === X1.id)!.name === `X1-${RUN}`, "restore content wrong");
  });

  // 16-19 -----------------------------------------------------------
  const pAdmin = await uiLogin(browser, ADMIN.email, ADMIN.password);
  await scenario(16, "השוואת תכנון מול ביצוע מזהה שינויי תאריכים לפי ID", async () => {
    // שינוי שם אינו שובר את ההתאמה (התאמה לפי ID ולא לפי שם)
    const cur = (await json<PlanData>(admin, "GET", "/api/plan")).body.items.find((i) => i.id === X1.id)!;
    await json(admin, "PATCH", `/api/items/${X1.id}`, { version: cur.version, patch: { name: `X1-שם-חדש-${RUN}` } });
    await pAdmin.goto(`${BASE}/plan?view=compare&base=${snapId}`);
    await pAdmin.waitForSelector(`[data-unit="${X1.id}"]`, { state: "attached" });
    const u = pAdmin.locator(`[data-unit="${X1.id}"]`);
    assert(await u.locator("[data-plan]").count() === 1 && await u.locator("[data-actual]").count() === 1, "X1 not matched by ID (missing plan or actual)");
    await pAdmin.waitForTimeout(600); // הגלילה הראשונית לשבוע הנוכחי מסתירה Tooltip פתוח
    let tipText = "";
    for (let k = 0; k < 3 && !tipText.includes("נדחתה"); k++) {
      await u.locator("[data-actual]").hover({ position: { x: 6, y: 6 } });
      await pAdmin.mouse.move((await u.locator("[data-actual]").boundingBox())!.x + 8, (await u.locator("[data-actual]").boundingBox())!.y + 8);
      await pAdmin.waitForTimeout(250);
      tipText = await pAdmin.locator("div.pointer-events-none.fixed").last().innerText({ timeout: 2000 }).catch(() => "");
    }
    assert(tipText.includes("נדחתה בשבועיים"), `tooltip: ${tipText}`);
    await shot(pAdmin, "16-compare");
  });

  await scenario(17, "ההשוואה אינה מפרידה תכנון וביצוע של אותו ID לשורות שונות", async () => {
    const ids = await pAdmin.locator("[data-unit]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.unit));
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    assert(dup.length === 0, `IDs rendered more than once: ${dup.slice(0, 5)}`);
    const sameLane = await pAdmin.locator("[data-unit]").evaluateAll((els) => els.every((e) => {
      const lane = e.closest("[data-lane-row]");
      return [...e.querySelectorAll("[data-plan],[data-actual]")].every((c) => c.closest("[data-lane-row]") === lane);
    }));
    assert(sameLane, "plan/actual of same ID in different lanes");
  });

  await scenario(18, "חפיפה בין IDs שונים יוצרת שורות וירטואליות נוספות", async () => {
    const lanes = await pAdmin.locator(`[data-lane-row="${cmpRow.id}"]`).count();
    assert(lanes === 2, `expected 2 virtual lanes for row, got ${lanes}`);
    const l1 = await pAdmin.locator(`[data-lane-row="${cmpRow.id}"]`).nth(0).locator("[data-unit]").evaluateAll((e) => e.map((x) => (x as HTMLElement).dataset.unit));
    const l2 = await pAdmin.locator(`[data-lane-row="${cmpRow.id}"]`).nth(1).locator("[data-unit]").evaluateAll((e) => e.map((x) => (x as HTMLElement).dataset.unit));
    assert(l1.length === 1 && l2.length === 1 && l1[0] !== l2[0], `lanes content ${l1} | ${l2}`);
  });

  await scenario(19, "יציאה ממצב השוואה מחזירה את הגאנט למבנה המקורי", async () => {
    await pAdmin.click("[data-testid=mode-gantt]");
    await pAdmin.waitForSelector("[data-testid=gantt-view]");
    await pAdmin.waitForSelector(`[data-bar="${X1.id}"]`);
    const lanes = await pAdmin.locator(`[data-lane-row="${cmpRow.id}"]`).count();
    assert(lanes === 1, `row has ${lanes} lanes after exit`);
    const plan = (await json<PlanData>(admin, "GET", "/api/plan")).body;
    assert(plan.rows.filter((r) => r.teamId === T_SYS).length === (await pAdmin.locator(`[data-team="${T_SYS}"] [data-lane-row]`).count()), "row count mismatch with DB");
  });

  // 20 --------------------------------------------------------------
  await scenario(20, "סינון/תצוגה אישית של משתמש אחד אינה משנה את התצוגה של משתמש אחר", async () => {
    const cfg = { domainIds: [AGAM], teamIds: [], statuses: ["BLOCKED"], priorities: [], search: "", time: { kind: "all" }, showMilestones: true, showSprints: false, density: "normal" };
    assert((await json(A, "POST", "/api/views", { name: `אישי ${RUN}`, config: cfg, isDefault: true })).status === 200, "save view failed");
    const vb = (await json<{ name: string }[]>(B, "GET", "/api/views")).body;
    assert(!vb.some((v) => v.name === `אישי ${RUN}`), "B sees A's view");
    const va = (await json<{ id: number; name: string }[]>(A, "GET", "/api/views")).body;
    const mine = va.find((v) => v.name === `אישי ${RUN}`)!;
    assert((await json(B, "DELETE", `/api/views/${mine.id}`)).status === 404, "B deleted A's view");
    // המסננים לא משנים נתונים
    const before = (await json<PlanData>(B, "GET", "/api/plan")).body.items.length;
    await pa.goto(`${BASE}/plan`);
    await pa.waitForSelector("[data-testid=gantt-view]");
    await pa.fill("[data-testid=search]", "zzz-nothing");
    await pa.waitForTimeout(300);
    const after = (await json<PlanData>(B, "GET", "/api/plan")).body.items.length;
    assert(before === after, "filtering changed data");
    await json(A, "DELETE", `/api/views/${mine.id}`);
  });

  // 21 --------------------------------------------------------------
  await scenario(21, "ספרינטים מוסתרים כברירת מחדל", async () => {
    const p = await uiLogin(browser, uB.email, PW);
    await p.waitForSelector("[data-testid=gantt-view]");
    await json(admin, "POST", "/api/sprints", { name: `Sprint-${RUN}`, startDate: cw, endDate: addWeeks(cw, 1), teamId: T_AZ1 });
    await p.reload(); await p.waitForSelector("[data-testid=gantt-view]");
    assert(!(await p.getByText(`Sprint-${RUN}`).count()), "sprint visible by default");
    await p.click("[data-testid=display-options]");
    await p.click("[data-testid=toggle-sprints]");
    await p.waitForTimeout(300);
    assert(await p.getByText(`Sprint-${RUN}`).count() > 0, "sprint not shown after toggle");
    await shot(p, "21-sprints-on");
    await p.waitForTimeout(800);
    await p.reload(); await p.waitForSelector("[data-testid=gantt-view]");
    assert(await p.getByText(`Sprint-${RUN}`).count() > 0, "sprint preference not persisted");
    await p.context().close();
  });

  // 22 --------------------------------------------------------------
  await scenario(22, "השבוע הנוכחי מסומן בצורה נכונה", async () => {
    await pa.goto(`${BASE}/plan`);
    await pa.waitForSelector("[data-testid=gantt-view]");
    const cls = await pa.locator(`[data-week="${cw}"]`).getAttribute("class");
    assert(cls?.includes("bg-brand-600"), `current week header not highlighted: ${cls}`);
    const others = await pa.locator("[data-week].bg-brand-600").count();
    assert(others === 1, `${others} weeks highlighted`);
    await pa.locator(`[data-week="${cw}"]`).hover();
    const tip = await pa.locator("div.pointer-events-none.fixed").last().innerText();
    assert(tip.includes("השבוע הנוכחי"), `week tooltip: ${tip}`);
  });

  // 23 --------------------------------------------------------------
  await scenario(23, "כותרות ועמודות קפואות נשארות במקום בעת גלילה", async () => {
    const hdr0 = (await pa.locator(`[data-week="${cw}"]`).boundingBox())!;
    const team0 = (await pa.locator(`[data-team="${T_AZ1}"] > div`).first().boundingBox())!;
    const cross0 = (await pa.locator("[data-cross=INFLUENCE] > div").first().boundingBox())!;
    await pa.locator("[data-testid=gantt-scroll]").evaluate((el) => { el.scrollTop += 400; el.scrollLeft -= 500; });
    await pa.waitForTimeout(300);
    const hdr1 = (await pa.locator(`[data-week="${cw}"]`).boundingBox())!;
    const cross1 = (await pa.locator("[data-cross=INFLUENCE] > div").first().boundingBox())!;
    assert(Math.abs(hdr1.y - hdr0.y) < 1, `week header moved vertically ${hdr0.y}→${hdr1.y}`);
    assert(Math.abs(cross1.y - cross0.y) < 1 && Math.abs(cross1.x - cross0.x) < 1, "cross rows label moved");
    const team1 = (await pa.locator(`[data-team="${T_AZ1}"] > div`).first().boundingBox())!;
    assert(Math.abs(team1.x - team0.x) < 1, `team column moved horizontally ${team0.x}→${team1.x}`);
    await shot(pa, "23-scrolled");
  });

  // 24 --------------------------------------------------------------
  await scenario(24, "נתונים נשמרים לאחר רענון הדף", async () => {
    assert(created7, "prereq");
    await pa.reload();
    await pa.waitForSelector(`[data-bar="${created7.id}"]`, { timeout: 15000 });
    const bg = await pa.locator(`[data-bar="${created7.id}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(bg === "rgb(220, 38, 38)", "status lost after refresh");
  });

  // 25 --------------------------------------------------------------
  await scenario(25, "עריכה מקבילה אינה גורמת לדריסה שקטה של מידע", async () => {
    const it = (await json<PlanData>(A, "GET", "/api/plan")).body.items.find((i) => i.id === itemA.id)!;
    const first = await json<ItemDTO>(A, "PATCH", `/api/items/${it.id}`, { version: it.version, patch: { notes: "עדכון של א" } });
    assert(first.status === 200, "first update failed");
    const second = await json<{ error: string; data: { conflict: string } }>(B, "PATCH", `/api/items/${it.id}`, { version: it.version, patch: { notes: "עדכון של ב" } });
    assert(second.status === 409 && second.body.data?.conflict === "version", `stale update not rejected: ${second.status}`);
    const final = (await json<PlanData>(A, "GET", "/api/plan")).body.items.find((i) => i.id === it.id)!;
    assert(final.notes === "עדכון של א", "data was overwritten");
    // חפיפה בשורה נאכפת בשרת
    const ov = await json(A, "POST", "/api/items", { rowId: it.rowId, name: "חופף", startWeek: it.startWeek, endWeek: it.endWeek });
    assert(ov.status === 409, `overlap accepted: ${ov.status}`);
  });


  // ---------------------------------------------------------------
  // בדיקות קשיחות נוספות (ממצאי סקירת קוד)
  // ---------------------------------------------------------------
  await scenario(26, "עדכון מקבילי של אבן דרך/ספרינט מחזיר 409 (לא 500)", async () => {
    const m = (await json<{ id: number; version: number }>(admin, "POST", "/api/milestones", { name: `M-${RUN}`, date: cw, teamId: T_AZ1 })).body;
    assert((await json(admin, "PATCH", `/api/milestones/${m.id}`, { version: m.version, patch: { name: "a" } })).status === 200, "first update");
    const r = await json(admin, "PATCH", `/api/milestones/${m.id}`, { version: m.version, patch: { name: "b" } });
    assert(r.status === 409, `stale milestone update → ${r.status}`);
    assert((await json(admin, "POST", `/api/milestones/${m.id}/restore`)).status === 404, "restore of live milestone allowed");
    const sp = (await json<{ id: number; version: number }>(admin, "POST", "/api/sprints", { name: `S-${RUN}`, startDate: cw, endDate: addWeeks(cw, 1), teamId: T_AZ1 })).body;
    await json(admin, "PATCH", `/api/sprints/${sp.id}`, { version: sp.version, patch: { name: "x" } });
    assert((await json(admin, "PATCH", `/api/sprints/${sp.id}`, { version: sp.version, patch: { name: "y" } })).status === 409, "stale sprint update");
  });

  await scenario(27, "מחיקה עם גרסה ישנה נדחית; קלט שגוי מחזיר 400 ולא 500", async () => {
    const r = await newRow(admin, T_AZ1);
    const it = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: r.id, name: "v", startWeek: cw, endWeek: cw })).body;
    await json(admin, "PATCH", `/api/items/${it.id}`, { version: it.version, patch: { notes: "changed" } });
    assert((await json(A, "DELETE", `/api/items/${it.id}?version=${it.version}`)).status === 409, "stale delete accepted");
    assert((await json(admin, "POST", "/api/rows", { teamId: 999999 })).status === 400, "bad teamId not 400");
    assert((await json(admin, "GET", "/api/admin/audit?limit=-5")).status === 200, "negative limit");
    assert((await json(admin, "POST", `/api/admin/users/${await userId(uA.email)}`, { action: "setPermissions", domainIds: [424242], canEditCross: false })).status === 400, "bogus domain id");
  });

  await scenario(28, "עריכת Snapshot: מזהים כפולים / לא מוכרים / חפיפה נדחים", async () => {
    const g = (await json<{ data: PlanData; revision: { id: number } }>(admin, "GET", `/api/snapshots/${snapId}`)).body;
    const post = (data: PlanData) => json(admin, "POST", `/api/snapshots/${snapId}/revisions`, { baseRevisionId: g.revision.id, note: "bad", data });
    const d1 = structuredClone(g.data); d1.items.push({ ...d1.items[0] });
    assert((await post(d1)).status === 400, "duplicate ids accepted");
    const d2 = structuredClone(g.data); d2.items.push({ ...d2.items[0], id: 987654, startWeek: addWeeks(cw, 80), endWeek: addWeeks(cw, 80) });
    assert((await post(d2)).status === 400, "unknown positive id accepted");
    const d3 = structuredClone(g.data); const x = d3.items.find((i) => i.id === X1.id)!;
    d3.items.push({ ...x, id: -5, name: "חופף" });
    assert((await post(d3)).status === 400, "overlap in snapshot accepted");
  });

  await scenario(29, "עדכונים מרובים מקבילים בסדר הפוך אינם נתקעים (Deadlock)", async () => {
    const r1 = await newRow(admin, T_SYS), r2 = await newRow(admin, T_SYS);
    const i1 = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: r1.id, name: "b1", startWeek: cw, endWeek: cw })).body;
    const i2 = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: r2.id, name: "b2", startWeek: cw, endWeek: cw })).body;
    for (let k = 0; k < 8; k++) {
      const p = (await json<PlanData>(admin, "GET", "/api/plan")).body;
      const a = p.items.find((i) => i.id === i1.id)!, b = p.items.find((i) => i.id === i2.id)!;
      const [x, y] = await Promise.all([
        json(admin, "POST", "/api/items/bulk", { entries: [{ id: a.id, version: a.version }, { id: b.id, version: b.version }], patch: { priority: "HIGH" } }),
        json(B, "POST", "/api/items/bulk", { entries: [{ id: b.id, version: b.version }, { id: a.id, version: a.version }], patch: { priority: "LOW" } }),
      ]);
      assert(x.status !== 500 && y.status !== 500, `server error ${x.status}/${y.status}`);
      assert([x.status, y.status].includes(200), "neither bulk succeeded");
    }
  });

  await scenario(30, "קישור איפוס סיסמה חד-פעמי, וחסימה אחרי ניסיונות כושלים", async () => {
    const link = (await json<{ link: string }>(admin, "POST", `/api/admin/users/${await userId(uB.email)}`, { action: "resetLink" })).body.link;
    const token = new URL(link).searchParams.get("token")!;
    const [r1, r2] = await Promise.all([
      json(P, "POST", "/api/auth/reset", { token, password: "New-Password-123" }),
      json(P, "POST", "/api/auth/reset", { token, password: "Other-Password-456" }),
    ]);
    assert([r1.status, r2.status].sort().join() === "200,400", `token reuse: ${r1.status}/${r2.status}`);
    const victim = `d-${RUN}@test.local`;
    await json(await ctx(), "POST", "/api/auth/register", { fullName: "ד", email: victim, password: PW, domainIds: [], requestCross: false });
    const att = await ctx();
    let last = 0;
    for (let k = 0; k < 11; k++) last = (await att.post("/api/auth/login", { data: { email: victim, password: "wrong" } })).status();
    assert(last === 429, `no lockout after failures (${last})`);
    const other = await ctx();
    assert((await other.post("/api/auth/login", { data: { email: ADMIN.email, password: ADMIN.password } })).ok(), "other accounts affected");
  });

  await scenario(31, "מצב השוואה הוא קריאה בלבד גם בחלונית התכולה", async () => {
    await pAdmin.goto(`${BASE}/plan?view=compare&base=${snapId}`);
    await pAdmin.waitForSelector(`[data-unit="${X1.id}"] [data-actual]`, { state: "attached" });
    await pAdmin.locator(`[data-unit="${X1.id}"] [data-actual]`).click();
    await pAdmin.waitForSelector("[data-testid=item-panel]");
    assert(!(await pAdmin.locator("[data-testid=panel-name]").count()), "name editable in compare");
    assert(await pAdmin.locator("#p-status").isDisabled(), "status editable in compare");
    assert(!(await pAdmin.getByText("מחיקת תכולה").count()), "delete available in compare");
  });

  await scenario(32, "חלונית תכולה: עריכה לא נשמרת לתכולה אחרת בעת מעבר בין קוביות", async () => {
    await pa.goto(`${BASE}/plan`);
    const plan = (await json<PlanData>(A, "GET", "/api/plan")).body;
    const mine = plan.items.filter((i) => i.teamId === T_AZ1 && i.startWeek >= cw).slice(0, 2);
    assert(mine.length === 2, "need two items");
    await pa.waitForSelector(`[data-bar="${mine[0].id}"]`);
    await pa.locator(`[data-bar="${mine[0].id}"]`).click();
    await pa.fill("#p-notes", `הערה ל-${mine[0].id}`);
    await pa.locator(`[data-bar="${mine[1].id}"]`).click();
    await pa.waitForTimeout(1200);
    const after = (await json<PlanData>(A, "GET", "/api/plan")).body;
    assert(after.items.find((i) => i.id === mine[0].id)!.notes === `הערה ל-${mine[0].id}`, "note for first item lost");
    assert(after.items.find((i) => i.id === mine[1].id)!.notes !== `הערה ל-${mine[0].id}`, "note saved to wrong item");
    assert((await pa.inputValue("#p-notes")) === after.items.find((i) => i.id === mine[1].id)!.notes, "panel shows stale notes");
  });

  // 33 --------------------------------------------------------------
  await scenario(33, "הגנת CSRF: בקשה משנה ממקור זר נחסמת, ממקור המערכת מתקבלת", async () => {
    const data = { teamId: T_AZ1 };
    const evil = await A.fetch("/api/rows", { method: "POST", data, headers: { Origin: "https://evil.example" } });
    assert(evil.status() === 403, `foreign origin got ${evil.status()}`);
    const own = await A.fetch("/api/rows", { method: "POST", data, headers: { Origin: new URL(BASE).origin } });
    assert(own.status() === 200, `own origin got ${own.status()}`);
    await json(A, "DELETE", `/api/rows/${((await own.json()) as RowDTO).id}`);
  });

  // 34 --------------------------------------------------------------
  await scenario(34, "מחיקת שורה 'ריקה' נדחית אם בינתיים נוסף לה תוכן", async () => {
    const row = await newRow(A, T_AZ1);
    const added = await json(admin, "POST", "/api/items", { rowId: row.id, name: `נוסף בינתיים ${RUN}`, startWeek: cw, endWeek: cw });
    assert(added.status === 200, `admin could not add item: ${added.status} ${JSON.stringify(added.body)}`);
    const r = await json(A, "DELETE", `/api/rows/${row.id}?ifEmpty=1`);
    assert(r.status === 409, `ifEmpty delete returned ${r.status}`);
    const plan = (await json<PlanData>(A, "GET", "/api/plan")).body;
    assert(plan.rows.some((x) => x.id === row.id) && plan.items.some((i) => i.rowId === row.id), "row or its item was deleted");
    assert((await json(A, "DELETE", `/api/rows/${row.id}`)).status === 200, "confirmed delete failed");
  });

  // 35 --------------------------------------------------------------
  await scenario(35, "בדיקת תקינות, כותרות אבטחה, ומשתמש ממתין אינו נחשף ברשימת המשתמשים", async () => {
    const h = await P.fetch("/api/health");
    assert(h.status() === 200, `health ${h.status()}`);
    assert((h.headers()["content-security-policy"] ?? "").includes("frame-ancestors 'none'"), "CSP header missing");
    const D = await ctx();
    const uD = `d-${RUN}@test.local`;
    await json(D, "POST", "/api/auth/register", { fullName: "משתמש ממתין", email: uD, password: PW, domainIds: [], requestCross: false });
    const dId = await userId(uD);
    const plan = (await json<PlanData>(A, "GET", "/api/plan")).body;
    assert(!plan.users.some((u) => u.id === dId), "pending user exposed in plan users");
    const creator = plan.items.find((i) => i.createdById !== null)?.createdById;
    assert(!creator || plan.users.some((u) => u.id === creator), "creator names missing");
  });

  await browser.close();
  console.log("\n────────────────────────────────────────");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} תרחישים עברו`);
  if (failed.length) { for (const f of failed) console.log(`  ✗ ${f.n}. ${f.name}: ${f.err}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
