// Run against an isolated, migrated and seeded DB and a running app:
// BASE_URL=http://localhost:3002 CHROME_PATH=/usr/bin/chromium node --env-file=.env --import tsx tests/e2e/multi-select.ts
import assert from "node:assert/strict";
import { chromium, request, type APIRequestContext } from "playwright";
import type { ItemDTO, PlanData } from "../../src/lib/types";
import { addWeeks, currentWeekIL } from "../../src/lib/weeks";

async function main() {
const baseURL = process.env.BASE_URL ?? "http://localhost:3002";
const tag = `multi-${Date.now()}`;
const admin = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
const rowIds: number[] = [];
async function json<T>(c: APIRequestContext, method: string, url: string, data?: unknown): Promise<T> {
  const r = await c.fetch(url, { method, data });
  assert(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
  return r.json();
}
const plan = () => json<PlanData>(admin, "GET", "/api/plan");
const entry = (i: ItemDTO, patch?: object) => ({ id: i.id, version: i.version, patch });
const batch = (action: string, entries: object[], c = admin) => c.post("/api/items/batch", { data: { action, entries } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await json(admin, "POST", "/api/auth/login", { email: process.env.SUPERUSER_EMAIL, password: process.env.SUPERUSER_PASSWORD });
  const initial = await plan();
  const team = initial.teams[0], otherTeam = initial.teams.find((t) => t.domainId !== team.domainId)!;
  const row = async (teamId: number) => {
    const r = await json<{ id: number }>(admin, "POST", "/api/rows", { teamId }); rowIds.push(r.id); return r.id;
  };
  const r1 = await row(team.id), r3 = await row(otherTeam.id);
  const week = currentWeekIL();
  const create = (name: string, rowId: number, startWeek: string) => json<ItemDTO>(admin, "POST", "/api/items", { name: `${tag}-${name}`, rowId, startWeek, endWeek: startWeek });
  let a = await create("A", r1, week), b = await create("B", r1, addWeeks(week, 1));
  const blocker = await create("blocker", r1, addWeeks(week, 3));
  const foreign = await create("foreign", r3, week);
  const fetchPair = async () => { const p = await plan(); a = p.items.find((i) => i.id === a.id)!; b = p.items.find((i) => i.id === b.id)!; };
  // Adjacent items can occupy another selected item's former position.
  const moved = await batch("update", [entry(a, { startWeek: addWeeks(week, 1), endWeek: addWeeks(week, 1) }), entry(b, { startWeek: addWeeks(week, 2), endWeek: addWeeks(week, 2) })]);
  assert.equal(moved.status(), 200, await moved.text());
  await fetchPair();
  assert.equal(a.startWeek, addWeeks(week, 1)); assert.equal(b.startWeek, addWeeks(week, 2));
  const original = [a, b];
  const collision = await batch("update", [entry(a, { startWeek: addWeeks(week, 2), endWeek: addWeeks(week, 2) }), entry(b, { startWeek: blocker.startWeek, endWeek: blocker.endWeek })]);
  assert.equal(collision.status(), 409);
  await fetchPair(); assert.deepEqual([a, b], original);
  const stale = await batch("update", [entry(a, { notes: "not allowed" }), entry(b, { status: b.status })]);
  assert.equal(stale.status(), 400);
  const staleUpdate = await batch("update", [entry(a, { startWeek: week, endWeek: week }), { id: b.id, version: b.version - 1, patch: { startWeek: addWeeks(week, 1), endWeek: addWeeks(week, 1) } }]);
  assert.equal(staleUpdate.status(), 409); await fetchPair(); assert.deepEqual([a, b], original);
  const staleVersion = await batch("delete", [entry(a), { id: b.id, version: b.version - 1 }]);
  assert.equal(staleVersion.status(), 409); await fetchPair(); assert.deepEqual([a, b], original);
  const duplicate = await batch("delete", [entry(a), entry(a)]); assert.equal(duplicate.status(), 400);

  const restricted = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const email = `${tag}@test.local`;
  await json(restricted, "POST", "/api/auth/register", { fullName: tag, email, password: "Multi-select-test-2026!", domainIds: [team.domainId], requestCross: false });
  const users = await json<{ id: number; email: string }[]>(admin, "GET", "/api/admin/users");
  const user = users.find((u) => u.email === email)!;
  await json(admin, "POST", `/api/admin/users/${user.id}`, { action: "approve", domainIds: [team.domainId], canEditCross: false });
  const denied = await batch("delete", [entry(a), entry(foreign)], restricted);
  assert.equal(denied.status(), 403); await fetchPair(); assert.deepEqual([a, b], original);
  await restricted.dispose();

  const deleted = await batch("delete", [entry(a), entry(b)]); assert.equal(deleted.status(), 200);
  const tombstones = await deleted.json() as ItemDTO[];
  assert(!(await plan()).items.some((i) => i.id === a.id || i.id === b.id));
  const restoreBlocker = await create("restore-blocker", r1, a.startWeek);
  const restoreConflict = await batch("restore", tombstones.map((i) => entry(i)));
  assert.equal(restoreConflict.status(), 409);
  assert(!(await plan()).items.some((i) => i.id === a.id || i.id === b.id));
  await json(admin, "DELETE", `/api/items/${restoreBlocker.id}?version=${restoreBlocker.version}`);
  const restored = await batch("restore", tombstones.map((i) => entry(i))); assert.equal(restored.status(), 200);
  await fetchPair();
  // Reset to the current week for browser interaction.
  await batch("update", [entry(a, { startWeek: week, endWeek: week }), entry(b, { startWeek: addWeeks(week, 1), endWeek: addWeeks(week, 1) })]);
  await fetchPair();
  const cat = await json<{ statuses: { key: string }[] }>(admin, "GET", "/api/catalog");
  const results = await Promise.all([
    batch("update", [entry(a, { status: cat.statuses[0].key }), entry(b, { status: cat.statuses[0].key })]),
    batch("update", [entry(b, { status: cat.statuses[1].key }), entry(a, { status: cat.statuses[1].key })]),
  ]);
  assert.deepEqual(results.map((r) => r.status()).sort(), [200, 409]);
  await fetchPair(); assert.equal(a.status, b.status);
  console.log("PASS API: adjacent move, overlap rollback, version rollback, validation, permissions, delete/restore");

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "he-IL", timezoneId: "Asia/Jerusalem", storageState: await admin.storageState() });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${baseURL}/plan?view=gantt&locate=${a.id}`);
  const bar = (id: number) => page.locator(`[data-bar="${id}"]`);
  await bar(a.id).waitFor();
  await bar(a.id).click({ modifiers: ["Control"] });
  await bar(b.id).click({ modifiers: ["Shift"] });
  await page.waitForFunction(() => document.querySelectorAll('[data-bar][data-selected="true"]').length === 2);
  assert.match(await page.getByTestId("bulk-bar").innerText(), /2 נבחרו/);
  assert.equal(await page.getByTestId("item-summary").count(), 0);
  await page.getByTestId("mode-table").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-item-row][data-selected="true"]').length === 2);
  await page.getByTestId("mode-gantt").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-bar][data-selected="true"]').length === 2);
  await page.screenshot({ path: "/workspace/.setup/multi-select.png" });
  const catalog = await json<{ statuses: { key: string }[]; priorities: { key: string }[] }>(admin, "GET", "/api/catalog");
  const previousStatus = a.status;
  const status = catalog.statuses.find((s) => s.key !== a.status)!.key;
  await bar(a.id).click({ button: "right" });
  const changed = page.waitForResponse((r) => r.url().endsWith("/api/items/batch") && r.request().method() === "POST");
  await page.locator(`[data-status-option="${status}"]`).click(); assert.equal((await changed).status(), 200);
  await fetchPair(); assert.equal(a.status, status); assert.equal(b.status, status);
  const priority = catalog.priorities.find((p) => p.key !== a.priority)!.key;
  await bar(b.id).click({ button: "right" });
  const priorityChanged = page.waitForResponse((r) => r.url().endsWith("/api/items/batch"));
  await page.locator(`[data-priority-option="${priority}"]`).click(); assert.equal((await priorityChanged).status(), 200);
  await fetchPair(); assert.equal(a.priority, priority); assert.equal(b.priority, priority);
  // Undo one group action restores each original priority in one request.
  const undone = page.waitForResponse((r) => r.url().endsWith("/api/items/batch"));
  await page.keyboard.press("Control+z"); assert.equal((await undone).status(), 200);
  await fetchPair(); assert.notEqual(a.priority, priority); assert.notEqual(b.priority, priority);

  const box = await bar(a.id).boundingBox(); assert(box);
  const weekW = await page.locator('[data-lane-row]').first().evaluate((el) => Number.parseFloat(getComputedStyle(el).getPropertyValue("--week-w")) || 0);
  // Adjacent bars start exactly one week apart; use their screen geometry.
  const boxB = await bar(b.id).boundingBox(); assert(boxB);
  const step = Math.abs(box.x - boxB.x) || weekW; assert(step > 10);
  // A blocked group drag must leave both items unchanged.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - step * 2, box.y + box.height / 2, { steps: 8 });
  await page.getByText(`הפעולה כולה תיחסם: חופף ל"${blocker.name}"`, { exact: true }).waitFor();
  await page.mouse.up(); await fetchPair(); assert.equal(a.startWeek, week); assert.equal(b.startWeek, addWeeks(week, 1));
  const dragged = page.waitForResponse((r) => r.url().endsWith("/api/items/batch"));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - step, box.y + box.height / 2 + 2, { steps: 8 }); await page.mouse.up();
  assert.equal((await dragged).status(), 200);
  await fetchPair(); assert.equal(a.startWeek, addWeeks(week, 1)); assert.equal(b.startWeek, addWeeks(week, 2)); assert.equal(a.rowId, r1); assert.equal(b.rowId, r1);
  const moveUndo = page.waitForResponse((r) => r.url().endsWith("/api/items/batch"));
  await page.keyboard.press("Control+z"); assert.equal((await moveUndo).status(), 200);
  await fetchPair(); assert.equal(a.startWeek, week); assert.equal(b.startWeek, addWeeks(week, 1));

  // Undo earlier group edits after undoing a later drag (versions advanced).
  const statusUndo = page.waitForResponse((r) => r.url().endsWith("/api/items/batch"));
  await page.keyboard.press("Control+z"); assert.equal((await statusUndo).status(), 200);
  await fetchPair(); assert.equal(a.status, previousStatus); assert.equal(b.status, previousStatus);
  await page.keyboard.press("Escape"); await page.getByTestId("bulk-bar").waitFor({ state: "detached" });
  await bar(a.id).click({ modifiers: ["Meta"] });
  assert.equal(await bar(a.id).getAttribute("data-selected"), "true");
  await bar(a.id).click({ modifiers: ["Meta"] }); await page.getByTestId("bulk-bar").waitFor({ state: "detached" });
  // Clicking an empty lane clears selection without undoing any saved action.
  await bar(a.id).click({ modifiers: ["Control"] });
  const bounds = await bar(a.id).evaluate((el) => { const r = el.closest("[data-lane-row]")!.getBoundingClientRect(); return { y: r.y, height: r.height }; });
  await page.mouse.click(box.x - step * 5, bounds.y + bounds.height / 2);
  await page.getByTestId("bulk-bar").waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  // Read-only mode clears selection and never exposes group edit controls.
  await bar(a.id).click({ modifiers: ["Control"] });
  await page.getByTestId("view-only-toggle").click();
  await page.getByTestId("bulk-bar").waitFor({ state: "detached" });
  await bar(a.id).click({ modifiers: ["Control"] });
  assert.equal(await page.getByTestId("bulk-bar").count(), 0);
  await bar(a.id).dblclick();
  await page.getByTestId("item-panel").waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("item-panel").waitFor({ state: "detached" });
  await page.getByTestId("view-only-toggle").click();
  // Table range selection and context-menu deletion share the same selection.
  console.log("PASS browser: selection across views, group status/priority/drag/undo, Ctrl/Meta/Escape");
  await page.getByTestId("mode-table").click();
  const tableRow = (id: number) => page.locator(`[data-item-row="${id}"]`);
  await tableRow(a.id).locator("td").first().click({ modifiers: ["Control"] });
  await tableRow(b.id).locator("td").first().click({ modifiers: ["Shift"] });
  assert.equal(await page.locator('[data-item-row][data-selected="true"]').count(), 2);
  await tableRow(a.id).locator("td").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "מחיקת 2 תכולות" }).click();
  const deletion = page.waitForResponse((r) => r.url().endsWith("/api/items/batch"));
  await page.getByRole("dialog").getByRole("button", { name: "מחיקה", exact: true }).click(); assert.equal((await deletion).status(), 200);
  assert(!(await plan()).items.some((i) => i.id === a.id || i.id === b.id));
  const restore = page.waitForResponse((r) => r.url().endsWith("/api/items/batch"));
  await page.keyboard.press("Control+z"); assert.equal((await restore).status(), 200); await fetchPair(); assert(a && b);
  await tableRow(a.id).locator("td").first().click({ modifiers: ["Control"] });
  await tableRow(b.id).locator("td").first().click({ modifiers: ["Control"] });
  const toolbarChanged = page.waitForResponse((r) => r.url().endsWith("/api/items/batch"));
  await page.getByTestId("bulk-priority").selectOption(priority); assert.equal((await toolbarChanged).status(), 200);
  await page.getByTestId("bulk-priority").focus();
  const toolbarUndo = page.waitForResponse((r) => r.url().endsWith("/api/items/batch"));
  await page.keyboard.press("Control+z"); assert.equal((await toolbarUndo).status(), 200);
  await fetchPair(); assert.notEqual(a.priority, priority); assert.notEqual(b.priority, priority);
  assert.deepEqual(errors, []);
  console.log("PASS browser: Ctrl/Meta/Shift, shared selection, status, priority, group drag, atomic delete and one-step undo");
} finally {
  await browser?.close();
  for (const id of rowIds) await admin.delete(`/api/rows/${id}`);
  await admin.dispose();
}

}
main().catch((e) => { console.error(e); process.exitCode = 1; });
