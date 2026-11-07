// Isolated, migrated and seeded database only.
// BASE_URL=http://localhost:3006 CHROME_PATH=/usr/bin/chromium node --env-file=.env --import tsx tests/e2e/display-weeks.ts
import assert from "node:assert/strict";
import { chromium, request, type APIRequestContext } from "playwright";
import type { ItemDTO, PlanData } from "../../src/lib/types";
import { currentWeekIL } from "../../src/lib/weeks";
import { defaultViewConfig } from "../../src/components/plan/filters";

async function main() {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3006";
  const admin = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const tag = `display-${Date.now()}`;
  const rows: number[] = [], snapshots: number[] = [], views: number[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  async function json<T>(method: string, path: string, data?: unknown, c: APIRequestContext = admin): Promise<T> {
    const r = await c.fetch(path, { method, data }); assert(r.ok(), `${path}: ${r.status()} ${await r.text()}`); return r.json();
  }
  try {
    await json("POST", "/api/auth/login", { email: process.env.SUPERUSER_EMAIL, password: process.env.SUPERUSER_PASSWORD });
    await json("PATCH", "/api/me/preferences", { fitBarText: false, barFontSize: 18, textSize: "md", ganttSize: { weekW: 44, rowH: 34 } });
    const source = await json<PlanData>("GET", "/api/plan");
    const week = currentWeekIL();
    const create = async (name: string, startWeek = week) => {
      const row = await json<{ id: number }>("POST", "/api/rows", { teamId: source.teams[0].id }); rows.push(row.id);
      return json<ItemDTO>("POST", "/api/items", { name, rowId: row.id, startWeek, endWeek: startWeek, status: "BLOCKED" });
    };
    const short = await create("א"), medium = await create("מוצר"), long = await create("תכולה עם מלל ארוך במיוחד שממשיך וממשיך כדי שלא ייכנס גם בגודל המזערי ".repeat(4));
    const last2026 = await create(`${tag}-53`, "2026-12-27"), first2027 = await create(`${tag}-1`, "2027-01-03");
    const unchanged = (await json<PlanData>("GET", "/api/plan")).items;
    const catalog = await json<{ statuses: { key: string; label: string; bg: string }[] }>("GET", "/api/catalog");
    assert.equal(catalog.statuses.find((s) => s.key === "BLOCKED")!.label, "לא בוצע");
    assert.equal(catalog.statuses.find((s) => s.key === "BLOCKED")!.bg, "#dc2626");
    for (const fitBarText of [true, false]) {
      const view = await json<{ id: number; config: { display: { fitBarText: boolean } } }>("POST", "/api/views", { name: `${tag}-${fitBarText}`, config: { ...defaultViewConfig(), display: { fitBarText, barFontSize: 18 } } });
      views.push(view.id); assert.equal(view.config.display.fitBarText, fitBarText);
    }
    const snapshot = await json<{ id: number }>("POST", "/api/snapshots", { name: tag, asOfDate: week, scope: "personal" }); snapshots.push(snapshot.id);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "he-IL", timezoneId: "Asia/Jerusalem", storageState: await admin.storageState() });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const label = (id: number, kind = "data-bar") => page.locator(`[${kind}="${id}"] [data-bar-label]`);
    const font = async (id: number, kind = "data-bar") => label(id, kind).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const waitFont = (id: number, size: number, kind = "data-bar") => page.waitForFunction(({ id, size, kind }) => {
      const el = document.querySelector(`[${kind}="${id}"] [data-bar-label]`); return el && parseFloat(getComputedStyle(el).fontSize) === size;
    }, { id, size, kind });
    await page.goto(`${baseURL}/plan?view=gantt&locate=${short.id}`); await label(short.id).waitFor(); await page.evaluate(() => document.fonts.ready);
    assert.equal(await font(short.id), 18); assert.equal(await font(medium.id), 18); assert.equal(await font(long.id), 18);
    assert.equal((await page.locator('[data-week="2026-12-27"]').innerText()).trim(), "53");
    assert.equal((await page.locator('[data-week="2027-01-03"]').innerText()).trim(), "1");
    assert.equal((await page.locator('[data-week="2027-01-10"]').innerText()).trim(), "2");
    await page.getByTestId("display-options").click(); assert.equal(await page.getByTestId("fit-bar-text").isChecked(), false);
    let saved = page.waitForResponse((r) => r.url().endsWith("/api/me/preferences") && r.request().method() === "PATCH");
    await page.getByTestId("fit-bar-text").check(); assert.equal((await saved).status(), 200);
    await waitFont(long.id, 10); assert.equal(await font(short.id), 18);
    assert((await font(medium.id)) < 18 && (await font(medium.id)) >= 10);
    assert(await label(long.id).evaluate((el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight), "minimum-size long text should still be clipped");
    await page.getByTestId("advanced-display").click();
    await page.getByTestId("week-width-input").fill("120"); await page.getByTestId("week-width-input").press("Enter");
    await waitFont(medium.id, 18); // Width change must refit upwards, not keep a stale small font.
    await page.getByTestId("week-width-input").fill("44"); await page.getByTestId("week-width-input").press("Enter");
    saved = page.waitForResponse((r) => r.url().endsWith("/api/me/preferences") && r.request().method() === "PATCH");
    await page.getByTestId("bar-font-input").fill("16"); await page.getByTestId("bar-font-input").press("Enter"); assert.equal((await saved).status(), 200);
    await waitFont(short.id, 16); await waitFont(long.id, 10);
    assert((await font(medium.id)) <= 16);
    await page.keyboard.press("Escape"); if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/display-fit.png` }); // צילום רק כשמבקשים (התיקייה הקודמת הייתה קבועה לסביבה אחת)
    await page.reload(); await label(short.id).waitFor(); await waitFont(short.id, 16); await waitFont(long.id, 10);
    await page.getByTestId("display-options").click(); assert.equal(await page.getByTestId("fit-bar-text").isChecked(), true);
    saved = page.waitForResponse((r) => r.url().endsWith("/api/me/preferences") && r.request().method() === "PATCH");
    await page.getByTestId("fit-bar-text").uncheck(); assert.equal((await saved).status(), 200); await waitFont(long.id, 16);
    await page.getByTestId("fit-bar-text").check(); await waitFont(long.id, 10); await page.keyboard.press("Escape");
    await page.goto(`${baseURL}/plan?view=compare&a=${snapshot.id}&b=live`); await label(short.id, "data-actual").waitFor();
    await waitFont(short.id, 16, "data-actual"); await waitFont(long.id, 10, "data-actual");
    assert((await font(medium.id, "data-actual")) <= 16);
    await json("POST", "/api/admin/personal-gantt", { action: "add", ids: [short.id, medium.id, long.id] });
    const workspace = await json<{ rows: { id: number }[] }>("GET", "/api/admin/personal-gantt/workspace");
    const own = await json<{ result: { items: ItemDTO[] } }>("POST", "/api/admin/personal-gantt/workspace", { action: "create", item: { rowId: workspace.rows[0].id, name: `${tag}-` + long.name, startWeek: week, endWeek: week } });
    const ownItem = own.result.items[0];
    await page.goto(`${baseURL}/my-gantt`); await label(ownItem.id).waitFor(); await waitFont(ownItem.id, 10); await waitFont(long.id, 10);
    await json("POST", "/api/admin/personal-gantt/workspace", { action: "delete", entries: [{ id: ownItem.id, version: ownItem.version }] });
    const after = (await json<PlanData>("GET", "/api/plan")).items;
    assert.deepEqual(after, unchanged, "display and week-number changes moved or edited stored contents");
    assert.equal(after.find((i) => i.id === last2026.id)!.startWeek, "2026-12-27");
    assert.equal(after.find((i) => i.id === first2027.id)!.startWeek, "2027-01-03");
    assert.deepEqual(errors, []);
    console.log("PASS: default off, independent font fitting, 10px floor, user maximum, width resizing, clipping, preference/saved-view persistence, compare/private Gantts, red label and unchanged dates with 53/2026 → 1/2027");
  } finally {
    await browser?.close();
    for (const id of views) await admin.delete(`/api/views/${id}`);
    for (const id of snapshots) await admin.delete(`/api/snapshots/${id}`);
    for (const id of rows) await admin.delete(`/api/rows/${id}`);
    await admin.dispose();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
