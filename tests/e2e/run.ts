/* eslint-disable no-console */
// בדיקות קצה-לקצה: 25 התרחישים המחייבים (סעיף 22 באפיון) ובדיקות קשיחות נוספות (מקביליות, קלט זדוני, אבטחה).
// הרצה מול שרת רץ: BASE_URL=http://localhost:3000 SUPERUSER_EMAIL=... SUPERUSER_PASSWORD=... npm run test:e2e
// מומלץ להריץ מול בסיס נתונים ייעודי לבדיקות — הבדיקות יוצרות משתמשים ותכולות.
import { chromium, request, type APIRequestContext, type Browser, type Page } from "playwright";
import { addWeeks, currentWeekIL, weekNumber } from "../../src/lib/weeks";
import type { ItemDTO, PlanData, RowDTO, SprintDTO } from "../../src/lib/types";

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
    assert((await json(C, "POST", "/api/snapshots", { name: "x", scope: "shared" })).status === 403, "C can create a shared snapshot");
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
    // סימון בלבד — לא קופצת חלונית; "+" באמצע הטווח פותח: תכולה / אבן דרך / ספרינט
    await pa.waitForSelector("[data-testid=sel-plus]");
    assert(!(await pa.locator("[data-testid=quick-create]").count()), "popup opened on plain selection");
    await pa.waitForTimeout(500);
    await pa.click("[data-testid=sel-plus]");
    await pa.click("[data-testid=sel-add-item]");
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
    await pa.click("[data-testid=add-fab]"); // כפתור ההוספה הצף נפתח לתכולה / אבן דרך / ספרינט
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
    // הסינונים נשמרים אישית (גם אלה שהגיעו מתצוגת ברירת המחדל) — מנקים כדי לא להשפיע על התרחישים הבאים
    await pa.keyboard.press("Escape");
    await pa.getByRole("button", { name: "ניקוי מסננים" }).click();
    await pa.waitForTimeout(1000);
    await json(A, "DELETE", `/api/views/${mine.id}`);
  });

  // 21 --------------------------------------------------------------
  await scenario(21, "ספרינטים מוסתרים כברירת מחדל", async () => {
    const p = await uiLogin(browser, uB.email, PW);
    await p.waitForSelector("[data-testid=gantt-view]");
    await json(admin, "POST", "/api/sprints", { name: `Sprint-${RUN}`, startDate: cw, endDate: addWeeks(cw, 1), domainId: AGAM });
    await p.reload(); await p.waitForSelector("[data-testid=gantt-view]");
    assert(!(await p.getByText(`Sprint-${RUN}`).count()), "sprint visible by default");
    // ריחוף על אייקון השכבה: הסבר מעליו — "הצג ספרינטים" (ואחרי לחיצה "הסתר ספרינטים")
    await p.hover("[data-testid=toggle-sprints]");
    const tipEl = p.locator("[data-testid=tooltip]");
    await tipEl.waitFor({ state: "visible" });
    assert((await tipEl.innerText()).trim() === "הצג ספרינטים", `tooltip: ${await tipEl.innerText()}`);
    const tb = (await tipEl.boundingBox())!, btn = (await p.locator("[data-testid=toggle-sprints]").boundingBox())!;
    assert(tb.y + tb.height <= btn.y + 1, "tooltip should be above the icon");
    await p.click("[data-testid=toggle-sprints]"); // מתג השכבה נמצא בשורת הסינון
    await p.waitForTimeout(150);
    assert((await tipEl.innerText()).trim() === "הסתר ספרינטים", `tooltip after click: ${await tipEl.innerText()}`);
    await p.waitForTimeout(300);
    assert(await p.getByText(`Sprint-${RUN}`).count() > 0, "sprint not shown after toggle");
    await shot(p, "21-sprints-on");
    await p.waitForTimeout(800);
    await p.reload(); await p.waitForSelector("[data-testid=gantt-view]");
    assert(await p.getByText(`Sprint-${RUN}`).count() > 0, "sprint preference not persisted");
    // הספרינט "מולבש" על בלוק התחום כולו — בלי שורה נוספת, ומתחת לקוביות
    const sp = (await json<PlanData>(admin, "GET", "/api/plan")).body.sprints.find((s) => s.name === `Sprint-${RUN}`)!;
    const band = p.locator(`[data-domain-overlay="${AGAM}"] [data-sprint="${sp.id}"] .sprint-band`);
    const domainBox = (await p.locator(`[data-domain="${AGAM}"]`).boundingBox())!;
    const bandBox = (await band.boundingBox())!;
    assert(Math.abs(bandBox.height - domainBox.height) <= 3 /* גבול התחום התחתון */, `band does not span the whole domain (${bandBox.height} vs ${domainBox.height})`);
    assert(!(await p.locator(`[data-domain="${ESH}"] [data-sprint="${sp.id}"]`).count()), "sprint shown on another domain");
    assert(await p.locator(`[data-domain-overlay="${AGAM}"]`).evaluate((el) => getComputedStyle(el).pointerEvents) === "none", "overlay blocks the gantt");
    await p.context().close();
    // הרשאות: עריכת ספרינט לפי תחום
    assert((await json(A, "POST", "/api/sprints", { name: "x", startDate: cw, endDate: cw, domainId: AGAM })).status === 200, "domain editor cannot create sprint");
    assert((await json(A, "POST", "/api/sprints", { name: "x", startDate: cw, endDate: cw, domainId: ESH })).status === 403, "user created sprint in a domain without permission");
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
  await scenario(23, "כותרות (שנה/חודש/שבוע) ועמודות קפואות נשארות במקום; שורות רוחביות נגללות", async () => {
    const hdr0 = (await pa.locator(`[data-week="${cw}"]`).boundingBox())!;
    const team0 = (await pa.locator(`[data-team="${T_AZ1}"] > div`).first().boundingBox())!;
    const cross0 = (await pa.locator("[data-cross=INFLUENCE] > div").first().boundingBox())!;
    await pa.locator("[data-testid=gantt-scroll]").evaluate((el) => { el.scrollTop += 400; el.scrollLeft -= 500; });
    await pa.waitForTimeout(300);
    const hdr1 = (await pa.locator(`[data-week="${cw}"]`).boundingBox())!;
    const cross1 = (await pa.locator("[data-cross=INFLUENCE] > div").first().boundingBox())!;
    assert(Math.abs(hdr1.y - hdr0.y) < 1, `week header moved vertically ${hdr0.y}→${hdr1.y}`);
    assert(cross1.y < cross0.y - 100, `cross rows should scroll up with the body (${cross0.y}→${cross1.y})`);
    assert(Math.abs(cross1.x - cross0.x) < 1, "cross rows label moved horizontally");
    // תכולה רוחבית שנגללת אל מתחת לעמודת התוויות ("גורמים משפיעים") — התווית מכסה אותה, ולא להפך
    await pa.locator("[data-testid=gantt-scroll]").evaluate((el) => { el.scrollTop = 0; });
    const label = (await pa.locator("[data-cross=INFLUENCE] > div").first().boundingBox())!;
    const bar = pa.locator("[data-cross=INFLUENCE] [data-bar]").first();
    const bb = (await bar.boundingBox())!;
    const delta = (label.x + label.width / 2) - (bb.x + bb.width / 2);
    await pa.locator("[data-testid=gantt-scroll]").evaluate((el, d) => { el.scrollLeft -= d; }, delta);
    await pa.waitForTimeout(300);
    const bb2 = (await bar.boundingBox())!;
    if (bb2.x + bb2.width > label.x + 5 && bb2.x < label.x + label.width - 5) {
      const px = Math.max(bb2.x, label.x) + 3, py = bb2.y + bb2.height / 2;
      const onBar = await pa.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-bar]"), [px, py]);
      assert(!onBar, "cross item is drawn over the frozen label column");
    }
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
    const sp = (await json<{ id: number; version: number }>(admin, "POST", "/api/sprints", { name: `S-${RUN}`, startDate: cw, endDate: addWeeks(cw, 1), domainId: AGAM })).body;
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
    await pa.locator(`[data-bar="${mine[0].id}"]`).dblclick();
    await pa.fill("#p-notes", `הערה ל-${mine[0].id}`);
    await pa.locator(`[data-bar="${mine[1].id}"]`).dblclick();
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

  // 36 --------------------------------------------------------------
  await scenario(36, "מנהל המערכת רואה בסרגל הצד תג עם מספר הבקשות הממתינות", async () => {
    const n = (await json<{ count: number }>(admin, "GET", "/api/admin/pending-count")).body.count;
    assert(n >= 1, `expected pending users, got ${n}`);
    assert((await json(A, "GET", "/api/admin/pending-count")).status === 403, "regular user can read pending count");
    await pAdmin.goto(`${BASE}/plan?view=gantt`);
    const badge = pAdmin.locator("[data-testid=nav-admin] [data-testid=pending-badge]");
    await badge.waitFor();
    assert((await badge.innerText()).trim() === String(n), `badge shows ${await badge.innerText()} instead of ${n}`);
    assert(!(await pa.locator("[data-testid=pending-badge]").count()), "badge visible to regular user");
  });

  // 37 --------------------------------------------------------------
  await scenario(37, "סינונים ותצוגה נשמרים אישית לכל משתמש (גם אחרי רענון)", async () => {
    await pa.goto(`${BASE}/plan?view=table`);
    await pa.waitForSelector("[data-testid=table-view]");
    await pa.fill("[data-testid=search]", `pref-${RUN}`);
    await pa.waitForTimeout(1200); // השמירה מתבצעת אחרי השהיה קצרה
    await pa.goto(`${BASE}/plan`); // בלי view — חוזר לתצוגה האחרונה (טבלה) עם אותו חיפוש
    await pa.waitForSelector("[data-testid=table-view]");
    assert((await pa.inputValue("[data-testid=search]")) === `pref-${RUN}`, "search filter not restored");
    const pb = await uiLogin(browser, uC.email, PW).catch(() => null);
    if (pb) {
      await pb.waitForSelector("[data-testid=search]");
      assert((await pb.inputValue("[data-testid=search]")) !== `pref-${RUN}`, "A's filter leaked to C");
      await pb.context().close();
    }
    await pa.fill("[data-testid=search]", "");
    await pa.waitForTimeout(1200);
    await pa.goto(`${BASE}/plan?view=gantt`);
    await pa.waitForSelector("[data-testid=gantt-view]");
  });

  // 38 --------------------------------------------------------------
  await scenario(38, "השוואה בין שני Snapshots: הסדר לפי תאריך; מקווקו רק לתכולה שתאריכיה השתנו", async () => {
    const row = await newRow(admin, T_SYS);
    const far = addWeeks(cw, 60);
    const moved = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: row.id, name: `זז-${RUN}`, startWeek: far, endWeek: far })).body;
    const still = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: row.id, name: `נשאר-${RUN}`, startWeek: addWeeks(far, 6), endWeek: addWeeks(far, 6) })).body;
    const sOld = (await json<{ id: number }>(admin, "POST", "/api/snapshots", { name: `ישן-${RUN}`, asOfDate: "2026-01-01" })).body;
    await json(admin, "PATCH", `/api/items/${moved.id}`, { version: moved.version, patch: { startWeek: addWeeks(far, 2), endWeek: addWeeks(far, 2) } });
    const sNew = (await json<{ id: number }>(admin, "POST", "/api/snapshots", { name: `חדש-${RUN}`, asOfDate: "2026-02-01" })).body;
    // בחירה בסדר "הפוך" (החדש כצד א) — המערכת מסדרת לפי תאריך
    await pAdmin.goto(`${BASE}/plan?view=compare&a=${sNew.id}&b=${sOld.id}`);
    await pAdmin.waitForSelector(`[data-unit="${moved.id}"]`, { state: "attached" });
    const sides = await pAdmin.locator("[data-testid=compare-sides]").innerText();
    assert(sides.indexOf(`ישן-${RUN}`) < sides.indexOf(`חדש-${RUN}`) && sides.includes("תכנון"), `sides: ${sides}`);
    assert(await pAdmin.locator(`[data-unit="${moved.id}"] [data-plan]`).count() === 1, "moved item has no dashed plan");
    assert(await pAdmin.locator(`[data-unit="${moved.id}"] [data-link]`).count() === 1, "moved item has no connector");
    assert(await pAdmin.locator(`[data-unit="${still.id}"] [data-plan]`).count() === 0, "unchanged item shows dashed plan");
    assert(await pAdmin.locator(`[data-unit="${still.id}"] [data-actual]`).count() === 1, "unchanged item not shown");
    // מצב סופי: רק המצב הנוכחי ותמונות מצב מאוחרות מהמצב ההתחלתי
    await pAdmin.selectOption("[data-testid=compare-side-a]", String(sOld.id));
    await pAdmin.waitForTimeout(300);
    let finals = await pAdmin.locator("[data-testid=compare-side-b] option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    assert(finals[0] === "live" && finals.includes(String(sNew.id)) && !finals.includes(String(sOld.id)), `final options (initial=old): ${finals}`);
    await pAdmin.selectOption("[data-testid=compare-side-a]", String(sNew.id));
    await pAdmin.waitForTimeout(300);
    finals = await pAdmin.locator("[data-testid=compare-side-b] option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    assert(!finals.includes(String(sOld.id)), `earlier snapshot offered as final state: ${finals}`);
    // סיום וחזרה לגאנט
    await pAdmin.click("[data-testid=compare-exit]");
    await pAdmin.waitForSelector("[data-testid=gantt-view]");
    // תאריך ה-Snapshot ניתן לעריכה
    assert((await json(admin, "PATCH", `/api/snapshots/${sOld.id}`, { asOfDate: "2025-12-01" })).status === 200, "edit asOfDate failed");
    const list = (await json<{ id: number; asOfDate: string }[]>(admin, "GET", "/api/snapshots")).body;
    assert(list.find((s) => s.id === sOld.id)?.asOfDate === "2025-12-01", "asOfDate not updated");
  });

  // 39 --------------------------------------------------------------
  await scenario(39, "הגדרות סטטוסים: הוספה, שינוי שם/צבע, מחיקה עם העברה — ומשפיע על הגאנט והמקרא", async () => {
    assert((await json(A, "POST", "/api/admin/statuses", { label: "x", bg: "#123456", category: "active" })).status === 403, "regular user changed statuses");
    const label = `בבדיקה-${RUN}`;
    const { key } = (await json<{ key: string }>(admin, "POST", "/api/admin/statuses", { label, bg: "#8b5cf6", category: "active", noteRecommended: false })).body;
    assert(key, "status not created");
    const row = await newRow(admin, T_SYS);
    const it = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: row.id, name: `סטטוס-חדש-${RUN}`, startWeek: cw, endWeek: cw, status: key })).body;
    assert(it.status === key, `item status ${it.status}`);
    assert((await json(admin, "PATCH", `/api/admin/statuses/${key}`, { label: `${label}-2`, bg: "#0ea5e9" })).status === 200, "rename failed");
    await pAdmin.goto(`${BASE}/plan?view=gantt`);
    await pAdmin.waitForSelector(`[data-bar="${it.id}"]`);
    assert((await pAdmin.locator("[data-testid=legend-statuses]").innerText()).includes(`${label}-2`), "legend not updated");
    const bg = await pAdmin.locator(`[data-bar="${it.id}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(bg === "rgb(14, 165, 233)", `bar color ${bg}`);
    // מחיקה בשימוש — חייבים חלופה
    assert((await json(admin, "DELETE", `/api/admin/statuses/${key}`)).status === 409, "delete in-use without replacement allowed");
    assert((await json(admin, "DELETE", `/api/admin/statuses/${key}?replaceWith=DONE`)).status === 200, "delete with replacement failed");
    const moved = (await json<PlanData>(admin, "GET", "/api/plan")).body.items.find((i) => i.id === it.id)!;
    assert(moved.status === "DONE", `item not moved: ${moved.status}`);
    const cat = (await json<{ statuses: { key: string; archived: boolean; label: string }[] }>(A, "GET", "/api/catalog")).body;
    assert(cat.statuses.find((s) => s.key === key)?.archived === true, "deleted status not archived (snapshots need its name)");
    assert((await json(admin, "POST", "/api/items", { rowId: row.id, name: "x", startWeek: addWeeks(cw, 3), endWeek: addWeeks(cw, 3), status: key })).status === 400, "archived status still usable");
    assert((await json(admin, "DELETE", "/api/admin/statuses/PLANNED?replaceWith=DONE")).status === 400, "default status deletable");
  });

  // 40 --------------------------------------------------------------
  await scenario(40, "תמונות מצב אישיות גלויות רק לבעליהן; משותפות לכולם", async () => {
    const mine = (await json<{ id: number }>(A, "POST", "/api/snapshots", { name: `אישי-${RUN}`, scope: "personal" })).body;
    assert(mine.id, "personal snapshot not created");
    const la = (await json<{ id: number; scope: string; canManage: boolean }[]>(A, "GET", "/api/snapshots")).body;
    const m = la.find((s) => s.id === mine.id);
    assert(m?.scope === "personal" && m.canManage, "personal snapshot not listed for owner");
    assert(la.some((s) => s.scope === "shared" && !s.canManage), "shared snapshots should be visible (read-only) to regular user");
    for (const [c, who] of [[C, "C"], [admin, "admin"]] as const) {
      assert(!(await json<{ id: number }[]>(c, "GET", "/api/snapshots")).body.some((s) => s.id === mine.id), `${who} sees A's personal snapshot`);
      assert((await json(c, "GET", `/api/snapshots/${mine.id}`)).status === 404, `${who} can open A's personal snapshot`);
      assert((await json(c, "PATCH", `/api/snapshots/${mine.id}`, { name: "hack" })).status === 404, `${who} can rename A's personal snapshot`);
    }
    assert((await json(A, "PATCH", `/api/snapshots/${mine.id}`, { name: `אישי-${RUN}-2` })).status === 200, "owner cannot rename");
    await pa.goto(`${BASE}/snapshots`);
    await pa.waitForSelector("[data-testid=my-snapshots]");
    assert((await pa.locator("[data-testid=my-snapshots]").innerText()).includes(`אישי-${RUN}-2`), "personal snapshot not in 'my snapshots' section");
    assert(!(await pa.locator("[data-testid=shared-snapshots]").innerText()).includes(`אישי-${RUN}`), "personal snapshot shown as shared");
  });

  // 41 --------------------------------------------------------------
  await scenario(41, "חיפוש מוצא תכולה ומאתר אותה בגאנט (גלילה והבהוב)", async () => {
    const row = await newRow(admin, T_SYS);
    const far = addWeeks(cw, 40);
    const target = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: row.id, name: `מחפשים-אותי-${RUN}`, startWeek: far, endWeek: far })).body;
    await pa.goto(`${BASE}/plan?view=gantt`);
    await pa.waitForSelector(`[data-bar="${target.id}"]`, { state: "attached" });
    await pa.waitForTimeout(400);
    await pa.fill("[data-testid=search]", `מחפשים-אותי-${RUN}`);
    await pa.waitForSelector(`[data-testid=search-results] [data-result="${target.id}"]`);
    await pa.keyboard.press("Enter");
    await pa.waitForTimeout(900);
    const bar = pa.locator(`[data-bar="${target.id}"]`);
    assert(await bar.evaluate((el) => el.classList.contains("locate-flash")), "item not highlighted");
    const bb = (await bar.boundingBox())!;
    const vp = pa.viewportSize()!;
    assert(bb.x > 0 && bb.x + bb.width < vp.width && bb.y > 0 && bb.y < vp.height, `item not scrolled into view ${JSON.stringify(bb)}`);
    await pa.fill("[data-testid=search]", "");
    await pa.waitForTimeout(800);
  });

  // 42 --------------------------------------------------------------
  await scenario(42, "גודל תצוגה אישי (הגדלה) — וסימון טווח בגאנט עדיין מדויק; חלונית ההוספה נסגרת ב-X", async () => {
    const row = await newRow(A, T_AZ1);
    await pa.goto(`${BASE}/plan?view=gantt`);
    await pa.waitForSelector(`[data-lane-row="${row.id}"]`);
    await pa.click("[data-testid=display-options]");
    await pa.click("[data-testid=text-size] [data-value=xl]");
    await pa.keyboard.press("Escape");
    await pa.waitForTimeout(500);
    const zoom = await pa.locator("[data-testid=sidebar]").evaluate((el) => getComputedStyle(el.parentElement!).zoom);
    assert(zoom === "1.25", `zoom is ${zoom}`);
    await pa.locator("[data-testid=gantt-view]").evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    const lb = (await pa.locator(`[data-lane-row="${row.id}"]`).first().boundingBox())!;
    const wb = (await pa.locator(`[data-week="${cw}"]`).boundingBox())!;
    const y = lb.y + lb.height / 2, x1 = wb.x + wb.width / 2, x2 = x1 - wb.width * 2;
    // X סוגר את חלונית ההוספה המהירה
    await pa.mouse.move(x1, y); await pa.mouse.dblclick(x1, y); // לחיצה כפולה על תא = ישר להוספת תכולה
    await pa.waitForSelector("[data-testid=quick-create]");
    await pa.click("[data-testid=quick-close]");
    assert(!(await pa.locator("[data-testid=quick-create]").count()), "quick-create not closed by X");
    // סימון 3 שבועות בתצוגה מוגדלת
    await pa.mouse.move(x1, y); await pa.mouse.down(); await pa.mouse.move((x1 + x2) / 2, y, { steps: 4 }); await pa.mouse.move(x2, y, { steps: 4 }); await pa.mouse.up();
    await pa.waitForTimeout(500);
    await pa.click("[data-testid=sel-plus]");
    await pa.click("[data-testid=sel-add-item]");
    await pa.waitForSelector("[data-testid=quick-create]");
    await pa.fill("[data-testid=quick-name]", `זום-${RUN}`);
    await pa.keyboard.press("Enter");
    await pa.waitForTimeout(800);
    const it = (await json<PlanData>(A, "GET", "/api/plan")).body.items.find((i) => i.name === `זום-${RUN}`);
    assert(it && it.rowId === row.id && it.startWeek === cw && it.endWeek === addWeeks(cw, 2), `wrong placement at zoom: ${JSON.stringify(it)}`);
    // חזרה לגודל רגיל
    await pa.click("[data-testid=display-options]");
    await pa.click("[data-testid=text-size] [data-value=md]");
    await pa.keyboard.press("Escape");
  });

  // 43 --------------------------------------------------------------
  await scenario(43, "תפריט ה-+ (אבן דרך/ספרינט), קליק ימני על אבן דרך וספרינט, וכפתור ההוספה הצף לא זז", async () => {
    const row = await newRow(admin, T_SYS);
    const sp = (await json<SprintDTO>(admin, "POST", "/api/sprints", { name: `Sprint ${RUN} 7`, startDate: cw, endDate: addWeeks(cw, 1), domainId: AGAM })).body;
    const ms = (await json<{ id: number }>(admin, "POST", "/api/milestones", { name: `MS-${RUN}`, date: cw, teamId: T_SYS })).body;
    await pAdmin.goto(`${BASE}/plan?view=gantt`);
    await pAdmin.waitForSelector(`[data-lane-row="${row.id}"]`);
    if ((await pAdmin.getAttribute("[data-testid=toggle-sprints]", "aria-pressed")) !== "true") await pAdmin.click("[data-testid=toggle-sprints]");
    await pAdmin.waitForTimeout(400);
    // סימון תא → + → בשורת צוות: תכולה, אבן דרך, ספרינט
    await pAdmin.locator(`[data-lane-row="${row.id}"]`).first().evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    await pAdmin.waitForTimeout(300);
    const lb = (await pAdmin.locator(`[data-lane-row="${row.id}"]`).first().boundingBox())!;
    const wb = (await pAdmin.locator(`[data-week="${addWeeks(cw, 3)}"]`).boundingBox())!;
    await pAdmin.mouse.click(wb.x + wb.width / 2, lb.y + lb.height / 2);
    await pAdmin.waitForTimeout(500); // לחיצה מהירה מדי על ה-"+" נחשבת לחיצה כפולה (= תכולה)
    await pAdmin.click("[data-testid=sel-plus]");
    for (const t of ["sel-add-item", "sel-add-milestone", "sel-add-sprint"]) assert(await pAdmin.locator(`[data-testid=${t}]`).count() === 1, `missing ${t}`);
    await pAdmin.click("[data-testid=sel-add-sprint]");
    await pAdmin.waitForSelector("[data-testid=sprint-domain]");
    assert((await pAdmin.inputValue("[data-testid=sprint-domain]")) === String(plan0.teams.find((t) => t.id === T_SYS)!.domainId), "sprint domain not prefilled from row");
    await pAdmin.keyboard.press("Escape");
    // קליק ימני על אבן דרך
    await pAdmin.locator(`[data-team="${T_SYS}"] [data-marker=milestone]`).first().click({ button: "right" });
    assert(await pAdmin.getByText("עריכת אבן דרך").count() === 1, "milestone context menu missing");
    await pAdmin.keyboard.press("Escape");
    // קליק ימני על לשונית ספרינט → "הספרינט הבא" עם שם ממוספר
    await pAdmin.locator(`[data-sprint="${sp.id}"] .sprint-tab`).click({ button: "right" });
    await pAdmin.getByText("הוספת הספרינט הבא").click();
    await pAdmin.waitForSelector("[data-testid=sprint-domain]");
    assert((await pAdmin.locator("div[role=dialog] input").first().inputValue()) === `Sprint ${RUN} 8`, "next sprint name not incremented");
    await pAdmin.keyboard.press("Escape");
    // כפתור ההוספה הצף לא זז כשהאפשרויות נפתחות
    const f0 = (await pAdmin.locator("[data-testid=add-fab]").boundingBox())!;
    await pAdmin.hover("[data-testid=add-fab]");
    await pAdmin.waitForSelector("[data-testid=add-item]");
    const f1 = (await pAdmin.locator("[data-testid=add-fab]").boundingBox())!;
    assert(Math.abs(f0.x - f1.x) < 1 && Math.abs(f0.y - f1.y) < 1, `FAB moved ${JSON.stringify(f0)} → ${JSON.stringify(f1)}`);
    const order = await pAdmin.locator("[data-testid=add-fab-menu] button[data-testid^=add-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    assert(JSON.stringify(order.slice(0, 3)) === JSON.stringify(["add-item", "add-milestone", "add-sprint"]), `FAB order ${order}`);
    await pAdmin.mouse.move(800, 300);
    void ms;
  });

  // 44 --------------------------------------------------------------
  await scenario(44, "תכולות: בלי מידע רוחבי, ID אחרון, מקטעים מתכווצים והסתרה בקליק ימני; סינון לפי הרשאות; חשיפה אחרי הוספה; הקלדה פותחת תכולה", async () => {
    // סינון ברירת מחדל לפי הרשאות: משתמש חדש עם עריכה לאג"ם רואה רק את אג"ם
    const E = await ctx(); const uE = `e-${RUN}@test.local`;
    await json(E, "POST", "/api/auth/register", { fullName: "משתמש ה", email: uE, password: PW, domainIds: [AGAM], requestCross: false });
    await json(admin, "POST", `/api/admin/users/${await userId(uE)}`, { action: "approve", domainIds: [AGAM], canEditCross: false });
    const pe = await uiLogin(browser, uE, PW);
    await pe.goto(`${BASE}/plan?view=gantt`); await pe.waitForSelector("[data-testid=gantt-view]");
    const doms = await pe.locator("[data-testid=gantt-body] [data-domain]").evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.domain)));
    assert(doms.length === 1 && doms[0] === AGAM, `default filter by permissions: ${doms}`);
    // הקלדה כשיש טווח מסומן = הוספת תכולה עם התו שהוקלד
    const row = (await json<RowDTO>(E, "POST", "/api/rows", { teamId: T_AZ1 })).body;
    await pe.reload(); await pe.waitForSelector(`[data-lane-row="${row.id}"]`);
    await pe.locator(`[data-lane-row="${row.id}"]`).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await pe.waitForTimeout(300);
    const lb = (await pe.locator(`[data-lane-row="${row.id}"]`).first().boundingBox())!;
    const wb = (await pe.locator(`[data-week="${addWeeks(cw, 5)}"]`).boundingBox())!;
    await pe.mouse.click(wb.x + wb.width / 2, lb.y + lb.height / 2);
    await pe.waitForSelector("[data-testid=sel-plus]");
    // (Playwright מקליד עברית כהדבקת טקסט בלי אירועי מקלדת — לכן אותיות לטיניות, שנשלחות כהקשות אמיתיות)
    await pe.keyboard.type("Hello", { delay: 60 });
    await pe.waitForSelector("[data-testid=quick-create]");
    assert((await pe.inputValue("[data-testid=quick-name]")) === "Hello", `typed name: ${await pe.inputValue("[data-testid=quick-name]")}`);
    await pe.keyboard.press("Escape");
    // חשיפה אחרי הוספה: ספרינטים מוסתרים → הוספת ספרינט מציגה אותם
    assert((await pe.getAttribute("[data-testid=toggle-sprints]", "aria-pressed")) === "false", "sprints should start hidden");
    await pe.click("[data-testid=add-fab]"); await pe.click("[data-testid=add-sprint]");
    await pe.fill("div[role=dialog] input >> nth=0", `חשיפה-${RUN}`);
    await pe.click("div[role=dialog] button.btn-primary");
    await pe.waitForTimeout(800);
    assert((await pe.getAttribute("[data-testid=toggle-sprints]", "aria-pressed")) === "true", "sprints not revealed after adding a sprint");
    // קליק ימני על תחום → הסתרה (בגאנט, אצל המנהל)
    await pAdmin.goto(`${BASE}/plan?view=gantt`); await pAdmin.waitForSelector(`[data-domain="${ESH}"]`);
    await pAdmin.locator(`[data-domain-label="${ESH}"]`).click({ button: "right" });
    await pAdmin.getByText(/הסתרת התחום/).click();
    await pAdmin.waitForTimeout(300);
    assert(!(await pAdmin.locator(`[data-testid=gantt-body] [data-domain="${ESH}"]`).count()), "domain not hidden");
    // טבלה: בלי מידע רוחבי; ID העמודה האחרונה (השמאלית)
    const holiday = (await json<PlanData>(admin, "GET", "/api/plan")).body.items.find((i) => i.teamId === null)!;
    await pAdmin.goto(`${BASE}/plan?view=table`); await pAdmin.waitForSelector("[data-testid=table-view]");
    assert(!(await pAdmin.locator(`[data-item-row="${holiday.id}"]`).count()), "cross item shown in table");
    const heads = (await pAdmin.locator("thead th").allInnerTexts()).map((h) => h.trim());
    assert(heads[heads.length - 1] === "ID", `last column is ${heads[heads.length - 1]}`);
    // כל עמודה מתאימה לכותרת שלה (הכותרות והערכים באותו סדר)
    const anyItem = (await json<PlanData>(admin, "GET", "/api/plan")).body.items.find((i) => i.teamId !== null)!;
    const rowEl = pAdmin.locator(`[data-item-row="${anyItem.id}"]`);
    await rowEl.waitFor();
    const cells = rowEl.locator("td");
    assert((await cells.count()) === heads.length, `row has ${await cells.count()} cells, header ${heads.length}`);
    assert((await cells.nth(heads.indexOf("ID")).innerText()).trim() === String(anyItem.id), "ID column value mismatch");
    assert((await cells.nth(heads.indexOf("שם התכולה")).innerText()).includes(anyItem.name.slice(0, 5)), "name column value mismatch");
    assert(await cells.nth(heads.indexOf("סטטוס")).locator(`[data-testid=status-${anyItem.id}]`).count() === 1, "status column mismatch");
    // מקטע מתכווץ בלחיצה, נשמר אחרי רענון, ונפתח שוב
    const grp = pAdmin.locator(`[data-group="${T_AZ1}"] button`);
    const before = await pAdmin.locator("[data-item-row]").count();
    await grp.click(); await pAdmin.waitForTimeout(800);
    const after = await pAdmin.locator("[data-item-row]").count();
    assert(after < before, `group did not collapse (${before} → ${after})`);
    await pAdmin.reload(); await pAdmin.waitForSelector(`[data-group="${T_AZ1}"]`);
    assert((await pAdmin.locator("[data-item-row]").count()) === after, "collapse not persisted");
    await pAdmin.locator(`[data-group="${T_AZ1}"] button`).click();
    // קליק ימני על מקטע → הסתרת הצוות (משנה את הסינון)
    await pAdmin.locator(`[data-group="${T_AZ1}"] button`).click({ button: "right" });
    await pAdmin.locator("[data-testid=group-menu]").getByText(/הסתרת הצוות/).click();
    await pAdmin.waitForTimeout(300);
    assert(!(await pAdmin.locator(`[data-group="${T_AZ1}"]`).count()), "team not hidden from table");
    await pAdmin.getByRole("button", { name: "ניקוי מסננים" }).click();
    await pe.context().close();
  });

  // 45 --------------------------------------------------------------
  await scenario(45, "שחזור תכולה שנמחקה עם אותו ID (גם כשהשורה נמחקה); מנהל עורך Snapshot מהמסך ושומר גרסה", async () => {
    // שחזור מהחלון "תכולות שנמחקו" — אותו ID
    const r1 = await newRow(A, T_AZ1);
    const x = (await json<ItemDTO>(A, "POST", "/api/items", { rowId: r1.id, name: `נמחק-בטעות-${RUN}`, startWeek: addWeeks(cw, 8), endWeek: addWeeks(cw, 8) })).body;
    assert((await json(A, "DELETE", `/api/items/${x.id}?version=${x.version}`)).status === 200, "delete failed");
    await pa.goto(`${BASE}/plan?view=table`); await pa.waitForSelector("[data-testid=table-view]");
    await pa.click("[data-testid=deleted-items]");
    await pa.waitForSelector(`[data-deleted="${x.id}"]`);
    await pa.click(`[data-testid=restore-item-${x.id}]`);
    await pa.waitForTimeout(800);
    const back = (await json<PlanData>(A, "GET", "/api/plan")).body.items.find((i) => i.id === x.id);
    assert(back && back.rowId === r1.id, `not restored with same ID/row: ${JSON.stringify(back)}`);
    await pa.keyboard.press("Escape");
    // השורה נמחקה יחד עם התכולה → השחזור לשורה אחרת של אותו צוות, עדיין אותו ID
    const r2 = await newRow(A, T_AZ1);
    const y = (await json<ItemDTO>(A, "POST", "/api/items", { rowId: r2.id, name: `בשורה-שנמחקה-${RUN}`, startWeek: addWeeks(cw, 9), endWeek: addWeeks(cw, 9) })).body;
    await json(A, "DELETE", `/api/rows/${r2.id}`);
    const ry = await json<ItemDTO>(A, "POST", `/api/items/${y.id}/restore`);
    assert(ry.status === 200 && ry.body.id === y.id && ry.body.rowId !== r2.id && ry.body.teamId === T_AZ1, `restore after row delete: ${ry.status} ${JSON.stringify(ry.body)}`);
    // משתמש בלי הרשאה לתחום לא יכול לשחזר
    const eshRow = (await json<RowDTO>(admin, "POST", "/api/rows", { teamId: T_ESH })).body;
    const z = (await json<ItemDTO>(admin, "POST", "/api/items", { rowId: eshRow.id, name: `אש-${RUN}`, startWeek: addWeeks(cw, 9), endWeek: addWeeks(cw, 9) })).body;
    await json(admin, "DELETE", `/api/items/${z.id}`);
    assert((await json(A, "POST", `/api/items/${z.id}/restore`)).status === 403, "user restored item in a domain without permission");
    const listA = (await json<{ id: number; canRestore: boolean }[]>(A, "GET", "/api/items/deleted")).body;
    assert(!listA.some((i) => i.id === z.id), "deleted item from a domain without permission is listed");
    assert(listA.every((i) => i.canRestore), "list contains items the user cannot restore");
    // עריכת Snapshot ע"י מנהל המערכת: מהבאנר → עורך → שינוי סטטוס בטבלה → שמירה כגרסה חדשה
    const snap = (await json<{ id: number }>(admin, "POST", "/api/snapshots", { name: `לעריכה-${RUN}` })).body;
    const sdata = (await json<{ data: PlanData }>(admin, "GET", `/api/snapshots/${snap.id}`)).body.data;
    const target = sdata.items.find((i) => i.teamId === T_AZ1 && i.status !== "DONE")!;
    await pAdmin.goto(`${BASE}/plan?view=table&snap=${snap.id}`);
    await pAdmin.click("[data-testid=banner-edit-snapshot]");
    await pAdmin.waitForSelector("[data-testid=snapshot-editor-bar]");
    await pAdmin.getByRole("button", { name: "תכולות" }).first().click();
    await pAdmin.waitForSelector(`[data-testid=status-${target.id}]`);
    await pAdmin.selectOption(`[data-testid=status-${target.id}]`, "DONE");
    await pAdmin.fill("[data-testid=revision-note]", "תיקון בדיקה");
    await pAdmin.click("[data-testid=save-revision]");
    await pAdmin.waitForURL(/\/snapshots$/);
    const revs = (await json<{ revisionNo: number; note: string }[]>(admin, "GET", `/api/snapshots/${snap.id}/revisions`)).body;
    assert(revs.length === 2 && revs[0].note === "תיקון בדיקה", `revisions: ${JSON.stringify(revs)}`);
    const after = (await json<{ data: PlanData }>(admin, "GET", `/api/snapshots/${snap.id}`)).body.data;
    assert(after.items.find((i) => i.id === target.id)?.status === "DONE", "edit not saved in new revision");
    const orig = (await json<{ data: PlanData }>(admin, "GET", `/api/snapshots/${snap.id}?rev=${(await json<{ id: number; revisionNo: number }[]>(admin, "GET", `/api/snapshots/${snap.id}/revisions`)).body.find((r) => r.revisionNo === 1)!.id}`)).body.data;
    assert(orig.items.find((i) => i.id === target.id)?.status === target.status, "original revision was modified");
    // משתמש רגיל לא רואה כפתור עריכה ל-Snapshot משותף
    await pa.goto(`${BASE}/plan?view=gantt&snap=${snap.id}`);
    await pa.waitForSelector("[data-testid=snapshot-banner]");
    assert(!(await pa.locator("[data-testid=banner-edit-snapshot]").count()), "regular user sees edit button on shared snapshot");
  });

  // 46 --------------------------------------------------------------
  await scenario(46, "טבלה: בלי תיבות סימון, Ctrl+לחיצה וקליק ימני (סטטוס לכמה, מחיקה עם הסבר שחזור); הרשמה: עין ו-V; צפייה בלבד; סינון שורות רוחביות", async () => {
    const r = await newRow(A, T_AZ1);
    const mk = async (n: string, w: number) => (await json<ItemDTO>(A, "POST", "/api/items", { rowId: r.id, name: `${n}-${RUN}`, startWeek: addWeeks(cw, w), endWeek: addWeeks(cw, w) })).body;
    const i1 = await mk("טבלה1", 20), i2 = await mk("טבלה2", 21), i3 = await mk("טבלה3", 22);
    await pa.goto(`${BASE}/plan?view=table`); await pa.waitForSelector(`[data-item-row="${i1.id}"]`);
    assert(!(await pa.locator("[data-testid=table-view] input[type=checkbox]").count()), "checkbox column still present");
    // Ctrl+לחיצה על שתי שורות → קליק ימני → שינוי סטטוס לשתיהן
    const cellOf = (id: number) => pa.locator(`[data-item-row="${id}"] td`).nth(5);
    await cellOf(i1.id).click({ modifiers: ["ControlOrMeta"] });
    await cellOf(i2.id).click({ modifiers: ["ControlOrMeta"] });
    await pa.waitForSelector("[data-testid=bulk-bar]");
    assert((await pa.locator("[data-testid=bulk-bar]").innerText()).includes("2 נבחרו"), "multi-select failed");
    await cellOf(i2.id).click({ button: "right" });
    assert((await pa.locator("[data-testid=row-menu]").innerText()).includes("2 תכולות נבחרו"), "context menu not for selection");
    await pa.click("[data-testid=row-menu] [data-status-option=BLOCKED]");
    await pa.waitForTimeout(800);
    const pl = (await json<PlanData>(A, "GET", "/api/plan")).body;
    assert(pl.items.find((i) => i.id === i1.id)?.status === "BLOCKED" && pl.items.find((i) => i.id === i2.id)?.status === "BLOCKED", "bulk status via context menu failed");
    await pa.keyboard.press("Escape");
    // קליק ימני → מחיקה עם הסבר שחזור
    await cellOf(i3.id).click({ button: "right" });
    await pa.locator("[data-testid=row-menu]").getByText("מחיקת תכולה").click();
    const dlg = pa.locator("div[role=dialog]");
    await dlg.waitFor();
    assert((await dlg.innerText()).includes("תכולות שנמחקו"), "delete confirm lacks restore hint");
    await dlg.getByRole("button", { name: "מחיקה" }).click();
    await pa.waitForTimeout(800);
    assert(!(await json<PlanData>(A, "GET", "/api/plan")).body.items.some((i) => i.id === i3.id), "item not deleted");
    // גאנט: "צפייה בלבד" בצוות בלי הרשאה; קליק ימני על "גורמים משפיעים" → הסתרה
    await pa.goto(`${BASE}/plan?view=gantt`); await pa.waitForSelector("[data-cross=INFLUENCE]");
    assert(await pa.getByText("צפייה בלבד").count() > 0, "view-only label missing");
    assert(!(await pa.getByText("קריאה בלבד").count()), "old read-only label still shown");
    await pa.locator("[data-cross=INFLUENCE] > div").first().click({ button: "right" });
    await pa.getByText(/הסתרת השורה/).click();
    await pa.waitForTimeout(300);
    assert(!(await pa.locator("[data-cross=INFLUENCE]").count()), "influence row not hidden");
    await pa.getByRole("button", { name: "ניקוי מסננים" }).click();
    await pa.waitForSelector("[data-cross=INFLUENCE]");
    // הרשמה: עין מציגה סיסמה; V כשהאימות תואם
    const pr = await (await browser.newContext()).newPage();
    await pr.goto(`${BASE}/register`);
    await pr.fill("#password", "Secret-123"); await pr.fill("#password2", "Secret-12");
    assert(!(await pr.locator("[data-testid=password2-match]").count()), "match icon shown for mismatch");
    await pr.fill("#password2", "Secret-123");
    await pr.waitForSelector("[data-testid=password2-match]");
    assert((await pr.getAttribute("#password", "type")) === "password", "password visible by default");
    await pr.click("[data-testid=password-eye]");
    assert((await pr.getAttribute("#password", "type")) === "text", "eye did not reveal password");
    assert((await pr.locator("form").innerText()).includes("לצפות בכל תוכנית העבודה"), "view-all note missing");
    await pr.context().close();
  });

  await browser.close();
  console.log("\n────────────────────────────────────────");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} תרחישים עברו`);
  if (failed.length) { for (const f of failed) console.log(`  ✗ ${f.n}. ${f.name}: ${f.err}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
