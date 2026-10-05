import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSwPatch } from "./mock.mjs";

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

/** Instrument EVERY service-worker instance (they restart and lose patches). */
async function instrumentSW(sw) {
  try {
    await sw.evaluate(() => {
      if (self.__msgTrace) return;
      self.__msgTrace = [];
      chrome.runtime.onMessage.addListener((msg) => {
        self.__msgTrace.push(msg?.type);
      });
      self.addEventListener("error", (e) => self.__msgTrace.push("ERR:" + String(e.message)));
      self.addEventListener("unhandledrejection", (e) => self.__msgTrace.push("REJ:" + String(e.reason)));
      const origSet = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = (items, cb) => {
        for (const [k, v] of Object.entries(items)) {
          if (v && typeof v === "object" && Array.isArray(v.projects)) {
            self.__msgTrace.push(
              `SET ${k} → [${v.projects.map((p) => p.name + (p.parentId ? `⤷${p.parentId.slice(0, 6)}` : "")).join(", ")}]`,
            );
          } else {
            self.__msgTrace.push(`SET ${k}`);
          }
        }
        return origSet(items, cb);
      };
    });
    await sw.evaluate(buildSwPatch());
  } catch {
    /* SW vanished */
  }
}
await instrumentSW(sw0);
context.on("serviceworker", (sw) => void instrumentSW(sw));
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

await context.route("https://timestripe.com/app*", (route) => route.fulfill({ contentType: "text/html", body: FIXTURE }));
const page = await context.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto("https://timestripe.com/app");
await page.waitForSelector("#tse-sidebar-trigger", { timeout: 15000 });

// replicate the run's dashboard ops
await page.click("#tse-sidebar-trigger");
await page.fill("#tse-panel-projects input.tse-input", "Playwright Project");
await page.click("#tse-panel-projects .tse-btn-primary");
await page.waitForSelector(".tse-project-row:has-text('Playwright Project')");
const row = page.locator(".tse-project-row", { hasText: "Playwright Project" });
await row.locator(".tse-icon-btn").first().click();
const input = page.locator(".tse-rename-input");
await input.fill("Renamed Proj");
await input.press("Enter");
await page.waitForSelector(".tse-project-row:has-text('Renamed Proj')");

const pid = await page.evaluate(() => {
  const sel = document.querySelector("#tse-new-project-parent");
  const opt = Array.from(sel.options).find((o) => o.textContent.includes("Renamed Proj"));
  return opt?.value ?? null;
});
console.log("[probe] parent option value:", pid);
await page.selectOption("#tse-new-project-parent", pid);
await page.focus("#tse-panel-projects input.tse-input");
await page.fill("#tse-panel-projects input.tse-input", "فقه");
// main-world synthetic clicks don't reach content-script listeners reliably — use Enter
await page.keyboard.press("Enter");
try {
  await page.waitForSelector(".tse-project-row:has-text('فقه')", { timeout: 4000 });
  console.log("[probe] sub created OK");
} catch {
  console.log("[probe] SW trace:", JSON.stringify(await sw0.evaluate(() => self.__msgTrace)));
  console.log("[probe] toasts:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll(".tse-toast")).map((t) => t.textContent))));
  console.log("[probe] panel debug:", JSON.stringify(await page.evaluate(() => ({
    inputValue: document.querySelector("#tse-panel-projects input.tse-input")?.value,
    inputCount: document.querySelectorAll("#tse-panel-projects input.tse-input").length,
    allInputs: Array.from(document.querySelectorAll("#tse-panel-projects input")).map((i) => ({ type: i.type, value: i.value?.slice(0, 20), cls: i.className.slice(0, 40) })),
    primaries: Array.from(document.querySelectorAll("#tse-panel-projects .tse-btn-primary")).map((b) => b.textContent),
    addBtnIsPrimary: document.querySelector("#tse-panel-projects .tse-btn-primary")?.textContent,
  }))));
  const stored0 = await sw0.evaluate(() => chrome.storage.local.get(null));
  console.log("[probe] CREATE FAILED — settings:", JSON.stringify(stored0.settings));
  console.log("[probe] data:global:", JSON.stringify(stored0["data:global"]?.projects));
  console.log("[probe] data:sp1:", JSON.stringify(stored0["data:sp1"]?.projects?.map((p) => p.name)));
  const rowsTxt = await page.evaluate(() => Array.from(document.querySelectorAll(".tse-project-row")).map((r) => r.textContent));
  console.log("[probe] visible rows:", JSON.stringify(rowsTxt));
  const parentVal = await page.evaluate(() => document.querySelector("#tse-new-project-parent")?.value);
  console.log("[probe] parent select value now:", parentVal);
  await context.close();
  process.exit(1);
}

// delete parent with promote
await page.locator(".tse-project-row", { hasText: "Renamed Proj" }).locator(".tse-btn-icon-del").click();
await page.waitForSelector(".tse-tree-backdrop");
await page.click(".tse-tree-backdrop .tse-btn-secondary:has-text('Delete parent only')");
await page.waitForTimeout(600);

// switch active space like T9 does
await page.click(".tse-dash-tab:has-text('Settings & Appearance')");
await page.click("#tse-panel-settings .tse-chip[data-space='sp2']");
await page.waitForTimeout(500);

const stored = await sw0.evaluate(() => chrome.storage.local.get(null));
console.log("[probe] settings:", JSON.stringify(stored.settings));
console.log("[probe] data:global projects:", JSON.stringify(stored["data:global"]?.projects?.map((p) => ({ n: p.name, p: p.parentId }))));
console.log("[probe] data:sp2 projects:", JSON.stringify(stored["data:sp2"]?.projects?.map((p) => p.name)));

// close dashboard, select rows, open bulk flyout
await page.click(".tse-dash-close-btn");
await page.waitForTimeout(300);
const rowA = page.locator(".GoalRowWrapper[data-draggable-id='col1::goal:AAAAAAAA']");
await rowA.hover();
await rowA.locator(".tse-select-btn").click();
await page.waitForSelector("#tse-selection-bar");
await page.click("#tse-selection-bar .tse-bar-btn:has-text('Project')");
await page.waitForSelector(".tse-bar-flyout");
await page.waitForTimeout(300);
console.log("[probe] FLYOUT:", JSON.stringify(await page.locator(".tse-bar-flyout").innerText()));

await page.locator(".tse-bar-flyout .tse-menu-row:has-text('Browse all projects…')").click({ timeout: 3000 }).catch(() => {});
await page.waitForSelector(".tse-tree-backdrop", { timeout: 5000 });
console.log("[probe] TREE MODAL ROWS:", await page.locator(".tse-tree-backdrop .tse-tree-row").count());
console.log("[probe] TREE MODAL TEXT:", JSON.stringify(await page.locator(".tse-tree-backdrop").innerText()));

await context.close();
