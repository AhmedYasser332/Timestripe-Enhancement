/**
 * Playwright E2E harness for the Timestripe Enhancement extension.
 *
 * Loads the REAL built extension (dist/) into Chromium, serves a local
 * Timestripe-like fixture at https://timestripe.com/app (route-fulfilled),
 * mocks the /api/v3/ endpoints INSIDE the service worker, seeds
 * chrome.storage, then drives every major UI flow end-to-end and prints a
 * PASS/FAIL summary.
 *
 * Run: npm run build && node tests/e2e/run.mjs   (HEADLESS=0 for a visible window)
 */

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DIST = path.join(ROOT, "dist");
const FIXTURE = readFileSync(path.join(__dirname, "fixture.html"), "utf8");

const HEADLESS = process.env.HEADLESS !== "0";

// Mock data seeded into the service worker (initial state only)
const MOCK_SPACES = [
  { id: "sp1", name: "دنيا" },
  { id: "sp2", name: "EXT-TEST" },
];
const MOCK_GOALS = [
  { id: "AAAAAAAA", name: "7:30 to 12:45", date: "2026-10-05", space_id: "sp1", parent_id: null },
  { id: "BBBBBBBB", name: "1.5 hrs Medo", date: "2026-10-06", space_id: "sp1", parent_id: null },
  { id: "CCCCCCCC", name: "1.0 hrs Next.js", date: null, space_id: "sp1", parent_id: null },
  { id: "DDDDDDDD", name: "0.5 hrs Business", date: "2026-10-10", space_id: "sp2", parent_id: null },
  { id: "EEEEEEEE", name: "مراجعة النص الثقيل من البرزة", date: null, space_id: "sp1", parent_id: null },
];

/**
 * Fully self-contained fetch replacement evaluated INSIDE the extension
 * service worker. No external references — everything is embedded.
 */
const SW_PATCH_SRC = `
(() => {
  if (self.__mockInstalled) return;
  self.__mockInstalled = true;
  self.__mockHits = 0;
  self.__patchHits = 0;
  const spaces = ${JSON.stringify(MOCK_SPACES)};
  const goals = ${JSON.stringify(MOCK_GOALS)};

  // Timestripe cascades a delete to every descendant (mirrors the real API).
  function cascadeDelete(id) {
    for (const k of goals.filter((g) => g.parent_id === id).map((g) => g.id)) cascadeDelete(k);
    const idx = goals.findIndex((g) => g.id === id);
    if (idx >= 0) goals.splice(idx, 1);
  }
  // Test hook: failNth(method, prefix, n, status) fails the nth matching request.
  self.__failPlan = [];
  self.__takeFailure = (method, pathname) => {
    for (const f of self.__failPlan) {
      if (f.method !== method || !pathname.startsWith(f.prefix)) continue;
      f.seen = (f.seen || 0) + 1;
      if (f.seen === f.n) return { status: f.status, body: { detail: "injected failure" } };
    }
    return null;
  };

  function handler(pathname, method, bodyObj) {
    self.__mockHits++;
    if (method === "PATCH") self.__patchHits++;
    if (pathname.endsWith("users/me/")) {
      return { status: 200, body: { id: "u1", email: "t@t.com", first_name: "Test", last_name: "User" } };
    }
    if (pathname.endsWith("spaces/")) return { status: 200, body: { results: spaces } };
    if (pathname.startsWith("goals/") && pathname.includes("space_id=")) {
      return { status: 200, body: { results: goals, next: null } };
    }
    const failure = self.__takeFailure(method, pathname);
    if (failure) return failure;
    const m = /^goals\\/([A-Za-z0-9]{8})\\/?$/.exec(pathname);
    if (m) {
      const goal = goals.find((g) => g.id === m[1]);
      if (method === "GET") return goal ? { status: 200, body: goal } : { status: 404, body: {} };
      if (method === "PATCH" && goal && bodyObj) { Object.assign(goal, bodyObj); return { status: 200, body: goal }; }
      if (method === "DELETE") {
        if (goal) cascadeDelete(goal.id);
        return { status: 204, body: "" };
      }
    }
    if (pathname === "goals/" && method === "POST" && bodyObj) {
      const id = Math.random().toString(36).slice(2, 6).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
      const goal = { id, name: "", date: null, space_id: "sp1", parent_id: null, ...bodyObj };
      goals.push(goal);
      return { status: 201, body: goal };
    }
    return { status: 404, body: {} };
  }

  const realFetch = self.fetch.bind(self);
  self.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const m = /^https:\\/\\/timestripe\\.com\\/api\\/v3\\/(.*)$/.exec(url);
    if (m) {
      const method = (init?.method ?? "GET").toUpperCase();
      let bodyObj = null;
      if (init?.body) { try { bodyObj = JSON.parse(init.body); } catch { bodyObj = null; } }
      const { status, body } = handler(m[1], method, bodyObj);
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return realFetch(input, init);
  };
})();
`;

// ---------------------------------------------------------------------------
// Tiny test framework
// ---------------------------------------------------------------------------
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name, ""]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    const msg = String(e?.message ?? e);
    results.push(["FAIL", name, msg]);
    const tail = msg.split("\n").filter(Boolean).slice(-3).join(" ⏎ ");
    console.log(`  ✗ ${name} — ${tail.slice(0, 600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "assertion failed");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: HEADLESS,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
  viewport: { width: 1440, height: 900 },
});

async function getSW() {
  let sw = context.serviceWorkers().at(-1);
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  return sw;
}
const patchSW = async (sw) => {
  try {
    await sw.evaluate(SW_PATCH_SRC);
  } catch (e) {
    console.log(`  [warn] SW patch failed: ${String(e).split("\n")[0]}`);
  }
};

// 1. Patch + seed the service worker BEFORE any page exists
const sw0 = await getSW();
await patchSW(sw0);
context.on("serviceworker", (sw) => void patchSW(sw));
await sw0.evaluate(async () => {
  await chrome.storage.local.set({
    apiKey: "test-key",
    settings: { activeSpaceId: "sp1", colorMode: "strip", showProjectName: true },
    "data:sp1": {
      projects: [
        { id: "proj1", name: "Work", color: "#00A8FF", spaceId: "sp1" },
        { id: "proj2", name: "Life", color: "#00E676", spaceId: null },
      ],
      taskProjectLinks: {},
      taskColorOverrides: {},
    },
    "data:global": { projects: [], taskProjectLinks: {}, taskColorOverrides: {} },
  });
});

// 2. Serve the fixture document at the real Timestripe URL (content script matches)
await context.route("https://timestripe.com/app*", (route) => route.fulfill({ contentType: "text/html", body: FIXTURE }));

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(String(err)));

await page.goto("https://timestripe.com/app");
await page.waitForSelector("#tse-sidebar-trigger", { timeout: 15000 });
const swHits = await sw0.evaluate(() => self.__mockHits ?? 0).catch(() => -1);
console.log(`  [info] mock API hits after page load: ${swHits}`);

console.log("\n=== Timestripe Enhancement — Playwright E2E ===\n");

// ------------------------- Sidebar & shortcuts -------------------------
await step("T1 sidebar trigger is injected in the bottom-left cluster", async () => {
  const box = await page.locator("#tse-sidebar-trigger").boundingBox();
  assert(box, "trigger not found");
  assert(box.x < 65, `trigger x=${box.x} should be < 65`);
  assert(box.y > 900 - 250, `trigger y=${box.y} should be in bottom 250px`);
});

await step("T2 double-K opens the dashboard; Esc closes it", async () => {
  await page.keyboard.press("k");
  await page.keyboard.press("k");
  await page.waitForSelector(".tse-dash-overlay", { timeout: 3000 });
  await page.keyboard.press("Escape");
  await sleep(200);
  assert((await page.locator(".tse-dash-overlay").count()) === 0, "overlay should close on Esc");
});

await step("T3 sidebar button opens the dashboard again", async () => {
  await page.click("#tse-sidebar-trigger");
  await page.waitForSelector(".tse-dash-overlay", { timeout: 3000 });
});

// ------------------------- Projects panel -------------------------
await step("T4 space chips exist and react instantly (دنيا → active)", async () => {
  await page.waitForSelector("#tse-new-project-scopes .tse-chip[data-scope='sp1']", { timeout: 5000 });
  await page.click("#tse-new-project-scopes .tse-chip[data-scope='sp1']");
  const cls = await page.getAttribute("#tse-new-project-scopes .tse-chip[data-scope='sp1']", "class");
  assert(cls.includes("active"), `دنيا chip should be active, got "${cls}"`);
  const globalCls = await page.getAttribute("#tse-new-project-scopes .tse-chip[data-scope='global']", "class");
  assert(!globalCls.includes("active"), "global chip should have lost active");
});

await step("T5 Add Project creates a row", async () => {
  await page.fill("#tse-panel-projects input.tse-input", "Playwright Project");
  await page.click("#tse-panel-projects .tse-btn-primary");
  await page.waitForSelector(".tse-project-row:has-text('Playwright Project')", { timeout: 5000 });
});

await step("T6 project color dot opens palette and changes the color", async () => {
  const row = page.locator(".tse-project-row", { hasText: "Playwright Project" });
  await row.locator(".tse-project-dot-btn").click();
  await page.waitForSelector(".tse-color-pop", { timeout: 3000 });
  await page.click(".tse-color-pop .tse-color-pop-swatch[title='#FF3D00']");
  await sleep(400);
  const bg = await row.locator(".tse-project-dot").evaluate((el) => el.style.background);
  assert(bg.includes("255, 61, 0"), `dot should become #FF3D00, got ${bg}`);
});

await step("T7 pencil renames a project inline", async () => {
  const row = page.locator(".tse-project-row", { hasText: "Playwright Project" });
  await row.locator(".tse-icon-btn").first().click();
  // the row's text is replaced by the input, so locate the input globally
  const input = page.locator(".tse-rename-input");
  await input.waitFor({ timeout: 3000 });
  await input.fill("Renamed Proj");
  await input.press("Enter");
  await page.waitForSelector(".tse-project-row:has-text('Renamed Proj')", { timeout: 5000 });
});

await step("T7b creates a sub-project that inherits scope (chips lock)", async () => {
  const pid = await page.evaluate(() => {
    const sel = document.querySelector("#tse-new-project-parent");
    const opt = Array.from(sel.options).find((o) => o.textContent.includes("Renamed Proj"));
    return opt?.value ?? null;
  });
  assert(pid, "parent option for Renamed Proj not found");
  await page.selectOption("#tse-new-project-parent", pid);
  const disabled = await page.getAttribute("#tse-new-project-scopes .tse-chip[data-scope='global']", "disabled");
  assert(disabled !== null, "scope chips should be disabled while a parent is selected");
  await page.fill("#tse-panel-projects input.tse-input", "فقه");
  await page.click("#tse-panel-projects .tse-btn-primary");
  const subRow = page.locator(".tse-project-row", { hasText: "فقه" });
  await subRow.waitFor({ timeout: 5000 });
  const indent = await subRow.evaluate((el) => Number.parseFloat(el.style.paddingInlineStart || "0"));
  assert(indent > 0, `sub row should be indented, got ${indent}`);
  const subScopeDisabled = await subRow.locator("select.tse-scope-select").getAttribute("disabled");
  assert(subScopeDisabled !== null, "sub row scope select should be locked");
  // reset the form parent for later tests
  await page.selectOption("#tse-new-project-parent", "");
});

await step("T7c delete dialog offers cascade vs promote; Cancel keeps everything", async () => {
  const parentRow = page.locator(".tse-project-row", { hasText: "Renamed Proj" });
  await parentRow.locator(".tse-btn-icon-del").click();
  await page.waitForSelector(".tse-tree-backdrop", { timeout: 3000 });
  assert(
    (await page.locator(".tse-tree-backdrop .tse-btn-danger:has-text('Delete everything')").count()) === 1,
    "cascade option should exist for a parent with subs",
  );
  assert(
    (await page.locator(".tse-tree-backdrop .tse-btn-secondary:has-text('Delete parent only')").count()) === 1,
    "promote option should exist for a parent with subs",
  );
  await page.click(".tse-tree-backdrop .tse-btn-secondary:has-text('Cancel')");
  await sleep(200);
  assert((await page.locator(".tse-tree-backdrop").count()) === 0, "dialog should close on cancel");
  assert((await page.locator(".tse-project-row", { hasText: "Renamed Proj" }).count()) === 1, "parent kept after cancel");
  assert((await page.locator(".tse-project-row", { hasText: "فقه" }).count()) === 1, "sub kept after cancel");
});

await step("T7d dashboard box is resizable from corner handle", async () => {
  const box = page.locator(".tse-dash-box");
  const initW = await box.evaluate((el) => el.offsetWidth);
  const initH = await box.evaluate((el) => el.offsetHeight);
  const seHandle = page.locator(".tse-rh-se");
  const hb = await seHandle.boundingBox();
  assert(hb, "SE resize handle should exist");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 120, hb.y + 80, { steps: 5 });
  await page.mouse.up();
  await sleep(200);
  const newW = await box.evaluate((el) => el.offsetWidth);
  const newH = await box.evaluate((el) => el.offsetHeight);
  assert(newW > initW + 50, `modal width should expand from ${initW} to > ${initW + 50}, got ${newW}`);
  assert(newH > initH + 40, `modal height should expand from ${initH} to > ${initH + 40}, got ${newH}`);
});

// ------------------------- Tabs / Settings -------------------------
await step("T8 tab switch to Settings is instant (0ms display toggle)", async () => {
  await page.click(".tse-dash-tab:has-text('Settings & Appearance')");
  const display = await page.evaluate(() => getComputedStyle(document.querySelector("#tse-panel-settings")).display);
  assert(display === "flex", `panel display should be flex, got ${display}`);
});

await step("T9 Active Space chips switch (EXT-TEST → active)", async () => {
  await page.click("#tse-panel-settings .tse-chip[data-space='sp2']");
  const cls = await page.getAttribute("#tse-panel-settings .tse-chip[data-space='sp2']", "class");
  assert(cls.includes("active"), `EXT-TEST chip should be active, got "${cls}"`);
  const toast = await page.locator(".tse-toast").last().textContent().catch(() => null);
  assert(toast && toast.includes("EXT-TEST"), `toast should mention EXT-TEST, got "${toast}"`);
});

await step("T10 mode cards toggle (Strip Mode selected)", async () => {
  await page.click(".tse-mode-card:has-text('Strip Mode')");
  const cls = await page.getAttribute(".tse-mode-card:has-text('Strip Mode')", "class");
  assert(cls.includes("selected"), "Strip Mode card should be selected");
});

await step("T10b restores the active space to دنيا (sp2 is intentionally empty)", async () => {
  await page.click("#tse-panel-settings .tse-chip[data-space='sp1']");
  const cls = await page.getAttribute("#tse-panel-settings .tse-chip[data-space='sp1']", "class");
  assert(cls.includes("active"), "دنيا chip should be active again");
});

await step("T11 Templates tab renders", async () => {
  await page.click(".tse-dash-tab:has-text('Templates')");
  await page.waitForSelector("#tse-panel-templates .tse-card", { timeout: 3000 });
});

await step("T12 marquee drag cannot start inside the open dashboard", async () => {
  await page.click(".tse-dash-tab:has-text('Projects')");
  await page.mouse.move(720, 120); // overlay area above the modal box
  await page.mouse.down();
  await page.mouse.move(1000, 500, { steps: 5 });
  await page.mouse.up();
  await sleep(200);
  assert((await page.locator("#tse-marquee-box").count()) === 0, "marquee box must not exist while modal open");
  // dragging the dimmed backdrop closes the dashboard (native behavior)
  assert((await page.locator(".tse-dash-overlay").count()) === 0, "dashboard should close after backdrop drag");
});

// ------------------------- Selection & Scheduler -------------------------
await step("T13 row checkboxes open the Selection Manager bar", async () => {
  // Middle-click triggers selection mode without hover layout shift
  const rowA = page.locator(".GoalRowWrapper[data-draggable-id='col1::goal:AAAAAAAA']");
  await rowA.click({ button: "middle" });
  await page.waitForSelector("#tse-selection-bar", { timeout: 3000 });
  const rowB = page.locator(".GoalRowWrapper[data-draggable-id='col1::goal:BBBBBBBB']");
  await rowB.locator(".tse-select-btn").click();
});

await step("T13b flyout lists parents only; hovering the parent opens its children", async () => {
  await page.click("#tse-selection-bar .tse-bar-btn:has-text('Project')");
  await page.waitForSelector(".tse-bar-flyout", { timeout: 3000 });
  const rowsText = await page.locator(".tse-bar-flyout").innerText();
  assert(rowsText.includes("Renamed Proj"), `parent should be listed, got: ${JSON.stringify(rowsText)}`);
  assert(!rowsText.includes("فقه"), `sub must stay hidden at top level, got: ${JSON.stringify(rowsText)}`);
  await page.hover(".tse-bar-flyout .tse-menu-row:has-text('Renamed Proj')");
  await page.waitForSelector(".tse-tree-flyout", { timeout: 3000 });
  const childText = await page.locator(".tse-tree-flyout").innerText();
  assert(childText.includes("فقه"), `child flyout should show the sub, got: ${JSON.stringify(childText)}`);
  const childRow = page.locator(".tse-tree-flyout .tse-menu-row:has-text('فقه')");
  await childRow.click();
  await page.waitForSelector(".tse-toast", { timeout: 3000 }).catch(() => {});
  const toast = await page.locator(".tse-toast").last().textContent().catch(() => "");
  assert(toast && toast.includes("Assigned 2 tasks to فقه"), `toast should confirm nested assign, got "${toast}"`);
});

await step("T13c Browse all opens the full tree modal with rails and assigns", async () => {
  await page.click("#tse-selection-bar .tse-bar-btn:has-text('Project')");
  await page.waitForSelector(".tse-bar-flyout", { timeout: 3000 });
  const browse = page.locator(".tse-bar-flyout .tse-menu-row:has-text('Browse all projects…')");
  assert((await browse.count()) === 1, "flyout should offer Browse all projects");
  // The click handler tears the flyout down mid-click, which Playwright can
  // report as a failed click even though the action fired — tolerate that.
  await browse.click({ timeout: 3000 }).catch(() => {});
  await page.waitForSelector(".tse-tree-backdrop", { timeout: 5000 });
  const modalText = await page.locator(".tse-tree-backdrop").innerText();
  const rows = await page.locator(".tse-tree-backdrop .tse-tree-row").count();
  assert(rows >= 5, `tree modal should list all projects incl. subs, got ${rows}: ${JSON.stringify(modalText)}`);
  assert(
    (await page.locator(".tse-tree-backdrop .tse-tree-guide").count()) >= 1,
    "connector rails should render for the sub",
  );
  await page.click(".tse-tree-backdrop .tse-tree-row:has-text('Work')");
  await sleep(300);
  assert((await page.locator(".tse-tree-backdrop").count()) === 0, "tree modal should close after pick");
  const toast = await page.locator(".tse-toast").last().textContent().catch(() => "");
  assert(toast && toast.includes("Assigned 2 tasks to Work"), `toast should confirm assignment, got "${toast}"`);
});

await step("T14 Schedule… opens the Fast Day Scheduler", async () => {
  await page.click("#tse-selection-bar .tse-bar-btn:has-text('Schedule…')");
  await page.waitForSelector(".tse-sched-modal-box", { timeout: 8000 });
  const title = await page.locator(".tse-modal-title span").first().textContent();
  assert(title.includes("2 tasks"), `title should say 2 tasks, got "${title}"`);
});

await step("T15 anchor button opens the native-style calendar", async () => {
  await page.click(".tse-sched-anchor-btn");
  await page.waitForSelector(".tse-cal-pop", { timeout: 3000 });
  const year = await page.locator(".tse-cal-navrow .tse-cal-navlabel").first().textContent();
  const month = await page.locator(".tse-cal-navrow .tse-cal-navlabel").nth(1).textContent();
  assert(year === "2026", `year should be 2026, got ${year}`);
  assert(month === "October", `month should be October, got ${month}`);
  const wk = await page.locator(".tse-cal-wk").nth(1).textContent();
  assert(/^W\d+$/.test(wk ?? ""), `week rows should render W##, got "${wk}"`);
});

await step("T16 picking a day updates the anchor label", async () => {
  await page.click(".tse-cal-day[data-date='2026-10-15']");
  await sleep(150);
  const label = await page.locator(".tse-sched-anchor-btn").textContent();
  assert(label.includes("Oct 15"), `anchor should show Oct 15, got "${label}"`);
});

await step("T17 'One per week' distributes weekly from the anchor", async () => {
  await page.click(".tse-sched-quick-btn:has-text('One per week')");
  await sleep(150);
  const first = await page.locator(".tse-sched-row").first().locator(".tse-sched-date-btn").textContent();
  const second = await page.locator(".tse-sched-row").nth(1).locator(".tse-sched-date-btn").textContent();
  assert(first.includes("Oct 15"), `first row should be Oct 15, got "${first}"`);
  assert(second.includes("Oct 22"), `second row should be Oct 22, got "${second}"`);
});

await step("T18 per-row calendar quick pill 'tomorrow' works", async () => {
  await page.locator(".tse-sched-row").nth(1).locator(".tse-sched-date-btn").click();
  await page.waitForSelector(".tse-cal-pop", { timeout: 3000 });
  await page.click(".tse-cal-pill:has-text('tomorrow')");
  await sleep(150);
  const after = await page.locator(".tse-sched-row").nth(1).locator(".tse-sched-date-btn").textContent();
  const tmrw = new Date(Date.now() + 86400000); // the pill means literal tomorrow
  const expected = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][tmrw.getMonth()]} ${tmrw.getDate()}`;
  assert(after.includes(expected), `row should be tomorrow (${expected}), got "${after}"`);
});

await step("T19 Apply Schedule PATCHes both goals and closes", async () => {
  const before = await sw0.evaluate(() => self.__mockHits ?? 0);
  await page.click(".tse-sched-modal-box .tse-btn-primary");
  await sleep(600);
  assert((await page.locator(".tse-sched-modal-box").count()) === 0, "scheduler should close after apply");
  const after = await sw0.evaluate(() => self.__mockHits ?? 0);
  assert(after >= before + 2, `expected ≥2 new API hits, got ${after - before}`);
});

await step("T20 Ctrl+Z undoes the schedule", async () => {
  await page.keyboard.press("Control+z");
  await sleep(800);
  const toast = await page.locator(".tse-toast").last().textContent().catch(() => "");
  assert(/undid/i.test(toast ?? ""), `toast should say "Undid…", got "${toast}"`);
});

await step("T20b delete dialog promote lifts فقه to top level", async () => {
  await page.click("#tse-sidebar-trigger");
  await page.waitForSelector(".tse-dash-overlay", { timeout: 3000 });
  await page.click(".tse-dash-tab:has-text('Projects')");
  const parentRow = page.locator(".tse-project-row", { hasText: "Renamed Proj" });
  await parentRow.locator(".tse-btn-icon-del").click();
  await page.waitForSelector(".tse-tree-backdrop", { timeout: 3000 });
  await page.click(".tse-tree-backdrop .tse-btn-secondary:has-text('Delete parent only')");
  await sleep(500);
  assert((await page.locator(".tse-project-row", { hasText: "Renamed Proj" }).count()) === 0, "parent should be deleted");
  const subRow = page.locator(".tse-project-row", { hasText: "فقه" });
  assert((await subRow.count()) === 1, "promoted sub should survive");
  const indent = await subRow.evaluate((el) => Number.parseFloat(el.style.paddingInlineStart || "0"));
  assert(indent <= 8, `promoted sub should sit at top level, indent=${indent}`);
  await page.click(".tse-dash-close-btn");
  await sleep(200);
});

// ------------------------- Popup Parity & Auto-complete -------------------------
await step("T22 extension popup renders tree hierarchy with rails and parent select", async () => {
  const extId = sw0.url().split("/")[2];
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extId}/src/popup/index.html`);
  await popupPage.waitForSelector(".project-item-card", { timeout: 5000 });
  const rowsCount = await popupPage.locator(".project-item-card").count();
  assert(rowsCount >= 2, `popup should list the projects, got ${rowsCount}`);
  const parentSelect = popupPage.locator(".add-project-card select");
  assert((await parentSelect.count()) === 1, "parent select should exist in popup");

  // Verify AUTO_COMPLETE_PARENT handler responds properly
  const acRes = await popupPage.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "AUTO_COMPLETE_PARENT", goalId: "BBBBBBBB", checked: true },
        (res) => resolve(res),
      );
    });
  });
  assert(acRes, "should receive response from AUTO_COMPLETE_PARENT");
  assert(acRes.ok, "AUTO_COMPLETE_PARENT response should be ok");

  await popupPage.close();
});

// ------------------------- Console errors -------------------------
await step("T21 no page JS errors during the whole run", async () => {
  const realErrors = pageErrors.filter((e) => !e.includes("ResizeObserver"));
  assert(realErrors.length === 0, `page errors: ${realErrors.slice(0, 3).join(" | ")}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
await step("F1 scheduler: a failing PATCH is reported, and Retry resends only that goal", async () => {
  // Fail the 2nd PATCH of the next apply; the other goal must still succeed.
  await sw0.evaluate(() => {
    self.__failPlan.push({ method: "PATCH", prefix: "goals/", n: 2, status: 500 });
  });
  await page.locator(".tse-bar-btn:has-text('Schedule')").first().click().catch(() => {});
  await page.waitForSelector(".tse-sched-modal-box", { timeout: 4000 });
  await page.click(".tse-sched-modal-box .tse-btn-primary");
  await sleep(700);
  const retryLabel = await page.locator(".tse-sched-modal-box .tse-btn-primary").textContent();
  assert(/Retry Failed \(1\)/.test(retryLabel), `expected "Retry Failed (1)", got "${retryLabel}"`);
  const failedRows = await page.locator(".tse-sched-row[data-goal-id][style*='outline']").count();
  assert(failedRows === 1, `expected exactly 1 highlighted failed row, got ${failedRows}`);

  // Retry: the injected failure was one-shot, so the retry must send exactly one PATCH.
  const patchesBefore = await sw0.evaluate(() => self.__patchHits ?? 0);
  await page.click(".tse-sched-modal-box .tse-btn-primary");
  await sleep(700);
  const sent = await sw0.evaluate(() => self.__patchHits ?? 0);
  assert(sent - patchesBefore === 1, `retry should send exactly 1 PATCH, sent ${sent - patchesBefore}`);
  assert((await page.locator(".tse-sched-modal-box").count()) === 0, "scheduler should close after full success");
});


console.log("\n=== SUMMARY ===");
const failed = results.filter(([s]) => s === "FAIL");
for (const [status, name, msg] of results) {
  if (status === "FAIL") console.log(`FAIL  ${name}\n      ${msg.split("\n")[0]}`);
}
console.log(`\n${results.length - failed.length}/${results.length} steps passed.`);
const totalHits = await sw0.evaluate(() => self.__mockHits ?? -1).catch(() => -1);
console.log(`Mock API hits: ${totalHits}`);

await context.close();
if (failed.length > 0) process.exit(1);


