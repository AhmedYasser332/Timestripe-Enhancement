import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSwPatch, SEED_STORAGE } from "./mock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DIST = path.join(ROOT, "dist");
const FIXTURE = readFileSync(path.join(__dirname, "fixture.html"), "utf8");

const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: process.env.HEADLESS !== "0",
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  viewport: { width: 1440, height: 900 },
});

const sw0 = (await context.serviceWorkers().at(-1)) ?? (await context.waitForEvent("serviceworker", { timeout: 15000 }));
await sw0.evaluate(buildSwPatch());
context.on("serviceworker", (sw) => void sw.evaluate(buildSwPatch()).catch(() => {}));
await sw0.evaluate(async () => {
  await chrome.storage.local.set({
    apiKey: "test-key",
    settings: { activeSpaceId: "sp1", colorMode: "strip", showProjectName: true },
    "data:sp1": {
      projects: [{ id: "proj1", name: "Work", color: "#00A8FF", spaceId: "sp1" }],
      taskProjectLinks: {},
      taskColorOverrides: {},
    },
    "data:global": { projects: [], taskProjectLinks: {}, taskColorOverrides: {} },
  });
});
console.log("[probe] seeded storage");

await context.route("https://timestripe.com/app*", (route) => route.fulfill({ contentType: "text/html", body: FIXTURE }));
const page = await context.newPage();
await page.goto("https://timestripe.com/app");
await page.waitForSelector("#tse-sidebar-trigger", { timeout: 15000 });
console.log("[probe] mock hits after load:", await sw0.evaluate(() => self.__mockHits));
await page.click("#tse-sidebar-trigger");
await page.click(".tse-dash-tab:has-text('Settings & Appearance')");
await page.waitForTimeout(1200);
console.log("[probe] mock hits after modal:", await sw0.evaluate(() => self.__mockHits));
const panelInfo = await page.evaluate(() => {
  const panel = document.querySelector("#tse-panel-settings");
  return {
    chipCount: document.querySelectorAll(".tse-chip").length,
    settingsChipCount: panel ? panel.querySelectorAll(".tse-chip").length : -1,
    display: panel ? getComputedStyle(panel).display : "missing",
    text: panel ? panel.textContent.slice(0, 120) : "missing",
  };
});
console.log("[probe] panel:", JSON.stringify(panelInfo));
await page.waitForSelector("#tse-panel-settings .tse-chip[data-space='sp2']", { timeout: 8000 });
await page.waitForTimeout(200);

// switch to settings tab
await page.waitForTimeout(100);

const chip = page.locator("#tse-panel-settings .tse-chip[data-space='sp2']");
const bb = await chip.boundingBox();
console.log("chip boundingBox:", bb);
const hits = await page.evaluate(
  ([x, y]) => document.elementsFromPoint(x, y).map((e) => `${e.tagName}.${e.className}`).slice(0, 8),
  [bb.x + bb.width / 2, bb.y + bb.height / 2],
);
console.log("elementsFromPoint at chip center:", hits);
console.log("chip pointer-events:", await chip.evaluate((el) => getComputedStyle(el).pointerEvents));

// does a dispatched click work?
const before = await page.locator(".tse-toast").count();
await chip.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await page.waitForTimeout(400);
const after = await page.locator(".tse-toast").count();
console.log(`dispatched click → toasts before=${before} after=${after}`);

// checkbox probe
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const cb = page.locator(".GoalRowWrapper[data-draggable-id='col1::goal:AAAAAAAA'] .tse-select-btn");
console.log("checkbox count:", await cb.count());
if ((await cb.count()) > 0) {
  const cbb = await cb.boundingBox();
  console.log("checkbox box:", cbb);
  if (cbb) {
    const chits = await page.evaluate(
      ([x, y]) => document.elementsFromPoint(x, y).map((e) => `${e.tagName}.${e.className}`).slice(0, 8),
      [cbb.x + cbb.width / 2, cbb.y + cbb.height / 2],
    );
    console.log("elementsFromPoint at checkbox center:", chits);
    console.log("checkbox pointer-events:", await cb.evaluate((el) => getComputedStyle(el).pointerEvents));
  }
}

// DOM churn probe around the checkbox
const churn = await page.evaluate(async () => {
  let mutations = 0;
  const obs = new MutationObserver((muts) => (mutations += muts.length));
  const row = document.querySelector(".GoalRowWrapper[data-draggable-id='col1::goal:AAAAAAAA']");
  obs.observe(row ?? document.body, { subtree: true, childList: true, attributes: true });
  await new Promise((r) => setTimeout(r, 800));
  obs.disconnect();
  return mutations;
});
console.log("row mutations in 800ms:", churn);

await context.close();
