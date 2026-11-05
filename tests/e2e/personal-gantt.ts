// Use an isolated migrated and seeded database.
// BASE_URL=http://localhost:3004 CHROME_PATH=/usr/bin/chromium node --env-file=.env --import tsx tests/e2e/personal-gantt.ts
import assert from "node:assert/strict";
import { chromium, request, type APIRequestContext } from "playwright";
import type { ItemDTO, PlanData } from "../../src/lib/types";
import { addWeeks, currentWeekIL } from "../../src/lib/weeks";

async function main() {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3004";
  const tag = `personal-${Date.now()}`;
  const admin = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const regular = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const anonymous = await request.newContext({ baseURL });
  const rows: number[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const endpoint = "/api/admin/personal-gantt";
  async function json<T>(c: APIRequestContext, method: string, url: string, data?: unknown): Promise<T> {
    const r = await c.fetch(url, { method, data });
    assert(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  }
  const plan = () => json<PlanData>(admin, "GET", "/api/plan");
  const change = (action: "add" | "remove", ids: number[]) => json(admin, "POST", endpoint, { action, ids });
  try {
    assert.equal((await anonymous.get(endpoint)).status(), 401);
    assert.equal((await anonymous.post(endpoint, { data: { action: "add", ids: [1] } })).status(), 401);
    await json(admin, "POST", "/api/auth/login", { email: process.env.SUPERUSER_EMAIL, password: process.env.SUPERUSER_PASSWORD });
    const existing = await json<{ ids: number[] }>(admin, "GET", endpoint);
    if (existing.ids.length) await change("remove", existing.ids);
    const initial = await plan();
    const team = initial.teams[0], other = initial.teams.find((t) => t.domainId !== team.domainId)!;
    const row = async (teamId: number) => { const r = await json<{ id: number }>(admin, "POST", "/api/rows", { teamId }); rows.push(r.id); return r.id; };
    const r1 = await row(team.id), empty = await row(team.id), r2 = await row(other.id);
    const week = currentWeekIL();
    const create = (name: string, rowId: number, startWeek: string) => json<ItemDTO>(admin, "POST", "/api/items", { name: `${tag}-${name}`, rowId, startWeek, endWeek: startWeek });
    const a = await create("A", r1, week), b = await create("B", r1, addWeeks(week, 2)), c = await create("C", r2, week);
    const before = (await plan()).items;
    await change("add", [a.id, a.id]); await change("add", [a.id]);
    assert.deepEqual((await json<{ ids: number[] }>(admin, "GET", endpoint)).ids, [a.id]);
    assert.deepEqual((await plan()).items, before, "curation modified the live plan");
    const bad = await admin.post(endpoint, { data: { action: "add", ids: [b.id, 2147483647] } }); assert.equal(bad.status(), 404);
    assert.deepEqual((await json<{ ids: number[] }>(admin, "GET", endpoint)).ids, [a.id]);
    const invalid = await admin.post(endpoint, { data: { action: "add", ids: [], userId: 999 } }); assert.equal(invalid.status(), 400);
    await change("remove", [a.id]);

    const email = `${tag}@test.local`;
    await json(regular, "POST", "/api/auth/register", { fullName: tag, email, password: "Personal-Gantt-Test-2026!", domainIds: [team.domainId], requestCross: false });
    assert.equal((await regular.get(endpoint)).status(), 403);
    const users = await json<{ id: number; email: string }[]>(admin, "GET", "/api/admin/users");
    const user = users.find((u) => u.email === email)!;
    await json(admin, "POST", `/api/admin/users/${user.id}`, { action: "approve", domainIds: [team.domainId], canEditCross: false });
    assert.equal((await regular.get(endpoint)).status(), 403);
    for (const action of ["add", "remove"]) assert.equal((await regular.post(endpoint, { data: { action, ids: [a.id] } })).status(), 403);
    const privatePage = await regular.get("/my-gantt", { maxRedirects: 0 }); assert.equal(privatePage.status(), 307); assert.equal(privatePage.headers().location, "/plan");
    console.log("PASS API: owner-only reads/writes, anonymous/pending/regular denial, idempotence, atomic validation, unchanged source");

    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "he-IL", timezoneId: "Asia/Jerusalem", storageState: await admin.storageState() });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const bar = (id: number) => page.locator(`[data-bar="${id}"]`);
    const savedResponse = () => page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().method() === "POST");
    await page.goto(`${baseURL}/plan?view=gantt&locate=${a.id}`);
    await bar(a.id).click({ button: "right" });
    const add = savedResponse(); await page.getByRole("menuitem", { name: "הוספה לגאנט שלי", exact: true }).click(); assert.equal((await add).status(), 200);
    assert.equal(await page.locator("[data-personal-item]").count(), 0, "private markers leaked into original view");
    await page.getByTestId("nav-personal-gantt").click();
    await page.getByTestId("personal-gantt-page").waitFor();
    await bar(a.id).waitFor();
    await page.locator(`[data-personal-item="${a.id}"]`).waitFor();
    assert.equal(await page.getByTestId("personal-show-source").isChecked(), false);
    assert.equal(await bar(b.id).count(), 0); assert.equal(await bar(c.id).count(), 0);
    assert.equal(await page.locator(`[data-lane-row="${empty}"]`).count(), 0);
    assert.equal(await page.locator(`[data-team="${other.id}"]`).count(), 0);
    assert.equal(await page.locator(`[data-personal-item="${a.id}"]`).count(), 1);
    assert.equal(await page.locator('[data-marker], [data-sprint]').count(), 0);
    await bar(a.id).click({ button: "right" });
    assert.equal(await page.locator("[data-status-option], [data-priority-option]").count(), 0);
    assert.equal(await page.getByRole("menuitem", { name: "מחיקת תכולה", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    const bounds = await bar(a.id).boundingBox(); assert(bounds);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.mouse.move(bounds.x - 90, bounds.y + bounds.height / 2, { steps: 6 }); await page.mouse.up();
    assert.deepEqual((await plan()).items, before, "dragging changed source data");
    await page.keyboard.press("Escape");
    await page.getByTestId("personal-show-source").check(); await bar(c.id).waitFor();
    assert.equal(await bar(c.id).evaluate((el) => getComputedStyle(el).opacity), "0.25");
    assert.equal(await bar(a.id).evaluate((el) => getComputedStyle(el).opacity), "1");
    assert.equal(await bar(a.id).count(), 1);
    await bar(b.id).click({ button: "right" });
    const addB = savedResponse(); await page.getByRole("menuitem", { name: "הוספה לגאנט שלי", exact: true }).click(); assert.equal((await addB).status(), 200);
    await page.waitForFunction((id) => !!document.querySelector(`[data-personal-item="${id}"]`), b.id);
    await page.screenshot({ path: "/workspace/.setup/personal-gantt.png" });
    await page.getByTestId("personal-show-source").uncheck(); await bar(b.id).waitFor();
    assert.equal(await bar(c.id).count(), 0);
    await bar(a.id).click({ modifiers: ["Control"] }); await bar(b.id).click({ modifiers: ["Shift"] });
    assert.match(await page.getByTestId("bulk-bar").innerText(), /2 נבחרו/);
    assert.equal(await page.getByTestId("bulk-status").count(), 0);
    const removeBoth = savedResponse(); await page.getByTestId("personal-gantt-remove").click(); assert.equal((await removeBoth).status(), 200);
    await page.getByTestId("personal-gantt-empty").waitFor(); assert.deepEqual((await plan()).items, before);

    await change("add", [a.id]); await page.reload(); await bar(a.id).waitFor();
    const updated = await json<ItemDTO>(admin, "PATCH", `/api/items/${a.id}`, { version: a.version, patch: { name: `${tag}-UPDATED`, startWeek: addWeeks(week, 1), endWeek: addWeeks(week, 1) } });
    await page.waitForFunction(({ id, name }) => document.querySelector(`[data-bar="${id}"]`)?.textContent?.includes(name), { id: a.id, name: updated.name }, { timeout: 20000 });
    await json(admin, "DELETE", `/api/items/${a.id}?version=${updated.version}`);
    await page.reload(); await page.getByTestId("personal-gantt-empty").waitFor();
    assert((await json<{ ids: number[] }>(admin, "GET", endpoint)).ids.includes(a.id));
    await json(admin, "POST", `/api/items/${a.id}/restore`); await page.reload(); await bar(a.id).waitFor();
    await bar(a.id).dblclick(); await page.getByTestId("item-panel").waitFor();
    assert.equal(await page.getByTestId("panel-name").count(), 0);
    await page.getByTestId("open-source-item").click(); await page.waitForURL(/\/plan\?/); await bar(a.id).waitFor();
    assert.equal(await page.locator("[data-personal-item]").count(), 0);

    const regularContext = await browser.newContext({ storageState: await regular.storageState() });
    const userPage = await regularContext.newPage(); await userPage.goto(`${baseURL}/plan?view=gantt`);
    assert.equal(await userPage.getByTestId("nav-personal-gantt").count(), 0);
    await userPage.goto(`${baseURL}/my-gantt`); assert(new URL(userPage.url()).pathname === "/plan");
    assert.equal(await userPage.locator("[data-personal-item]").count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS browser: original/overlay add, compact rows, private markers, source dimming, read-only drag and details, bulk removal, live sync, delete/restore, source navigation, regular-user privacy");
  } finally {
    await browser?.close();
    const membership = await json<{ ids: number[] }>(admin, "GET", endpoint).catch(() => ({ ids: [] }));
    if (membership.ids.length) await change("remove", membership.ids);
    for (const row of rows) await admin.delete(`/api/rows/${row}`);
    await Promise.all([admin.dispose(), regular.dispose(), anonymous.dispose()]);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
