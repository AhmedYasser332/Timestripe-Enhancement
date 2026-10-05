/**
 * Timestripe In-Page Dashboard Modal & Sidebar Integration.
 * - Multi-strategy sidebar detector for the bottom "+" button.
 * - Double "K" (and Arabic "ن", e.code === "KeyK") shortcut.
 * - 0ms instant tab switching (pre-rendered client-side panels).
 * - 100% native-matching dark theme (no purple, high-contrast readable chips,
 *   crisp tabs with bottom underline, right-aligned white primary buttons).
 */

import { sendToBg } from "./messaging";
import { getProjects, getSettings, getViewState } from "./state";
import { showToast } from "./toast";
import { bindActivate } from "./activate";
import type {
  GoalTemplate,
  Project,
  Settings,
  TSSpace,
  ViewState,
} from "../shared/types";
import type { BackupPayload } from "../shared/messages";

let activeModalEl: HTMLElement | null = null;
let currentTab: "projects" | "settings" | "templates" = "projects";
let lastKeyKTime = 0;
let sidebarRetryInterval: ReturnType<typeof setInterval> | null = null;

// Cached data for 0ms instant rendering
let cachedSpaces: TSSpace[] = [];
let cachedTemplates: GoalTemplate[] = [];

// Persistent New Project Form state so background sync never resets user input
let newProjectScope = "global";
let newProjectColor = "#00A8FF";

// Pre-fetch spaces and templates on script load so cachedSpaces is ready immediately
void sendToBg<TSSpace[]>({ type: "LIST_SPACES" }).then((res) => {
  if (res?.ok && res.data) cachedSpaces = res.data;
});
void sendToBg<GoalTemplate[]>({ type: "LIST_TEMPLATES" }).then((res) => {
  if (res?.ok && res.data) cachedTemplates = res.data;
});

const QUICK_COLORS = [
  "#FFFFFF", "#00A8FF", "#00E676", "#FFEA00",
  "#FF9100", "#FF3D00", "#F48FB1", "#7C5CFF",
];

/**
 * Shared color-picker popover (used by project rows and the New Project card).
 */
function openColorPopover(
  anchor: HTMLElement,
  currentColor: string,
  onPick: (color: string) => void,
): void {
  document.querySelectorAll(".tse-color-pop").forEach((el) => el.remove());

  const pop = document.createElement("div");
  pop.className = "tse-color-pop";

  const grid = document.createElement("div");
  grid.className = "tse-color-pop-grid";
  for (const c of QUICK_COLORS) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "tse-color-pop-swatch";
    sw.style.background = c;
    if (c.toUpperCase() === currentColor.toUpperCase()) sw.classList.add("selected");
    sw.title = c;
    bindActivate(sw, () => {
      onPick(c);
      pop.remove();
    });
    grid.appendChild(sw);
  }
  pop.appendChild(grid);

  const customRow = document.createElement("div");
  customRow.className = "tse-color-pop-custom";

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = /^#[0-9a-f]{6}$/i.test(currentColor) ? currentColor : "#00A8FF";

  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "tse-input tse-color-hex";
  hexInput.placeholder = "#RRGGBB";
  hexInput.value = colorInput.value;
  colorInput.oninput = () => {
    hexInput.value = colorInput.value;
  };
  hexInput.onchange = () => {
    if (/^#[0-9a-f]{6}$/i.test(hexInput.value.trim())) colorInput.value = hexInput.value.trim();
  };

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "tse-btn-primary tse-color-apply";
  applyBtn.textContent = "Apply";
  bindActivate(applyBtn, () => {
    const val = /^#[0-9a-f]{6}$/i.test(hexInput.value.trim()) ? hexInput.value.trim() : colorInput.value;
    onPick(val);
    pop.remove();
  });

  customRow.append(colorInput, hexInput, applyBtn);
  pop.appendChild(customRow);

  document.body.appendChild(pop);

  // Position near the anchor, clamped to the viewport
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let x = r.left;
  let y = r.bottom + 6;
  if (x + pw > window.innerWidth - 8) x = window.innerWidth - pw - 8;
  if (y + ph > window.innerHeight - 8) y = r.top - ph - 6;
  pop.style.left = `${Math.max(8, x)}px`;
  pop.style.top = `${Math.max(8, y)}px`;

  const dismiss = (e: PointerEvent) => {
    if (!pop.contains(e.target as Node) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener("pointerdown", dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
}

function injectDashboardStyles(): void {
  if (document.getElementById("tse-dashboard-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-dashboard-styles";
  style.textContent = `
    /* Sidebar trigger button */
    .tse-sidebar-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      margin: 8px auto 16px auto;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: #888888;
      cursor: pointer;
      transition: color 0.15s ease, background 0.15s ease;
      position: relative;
      flex-shrink: 0;
    }
    .tse-sidebar-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.08);
    }
    .tse-sidebar-btn svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* Modal Overlay & Box (Native Timestripe Dark Theme) */
    .tse-dash-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      /* Max z-index: no stale overlay of ours or of the page may ever sit above
         the dashboard and swallow its clicks. */
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: tseFadeIn 0.12s ease-out;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    /* Hard guarantee: nothing (from the page or from our own content styles)
       may ever disable pointer interaction inside the dashboard. */
    .tse-dash-overlay,
    .tse-dash-overlay * {
      pointer-events: auto !important;
    }

    .tse-dash-box {
      width: 680px;
      max-width: calc(100vw - 32px);
      height: 580px;
      max-height: calc(100vh - 40px);
      background: #1c1c1f;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85);
      color: #ffffff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: tseScaleIn 0.14s ease-out;
    }

    @keyframes tseFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes tseScaleIn {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }

    /* Header & Clean Timestripe Underline Tabs */
    .tse-dash-header {
      padding: 16px 20px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #1c1c1f;
    }

    .tse-dash-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .tse-dash-title {
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tse-dash-close-btn {
      background: none;
      border: none;
      color: #888888;
      font-size: 16px;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.12s ease;
    }
    .tse-dash-close-btn:hover {
      color: #ffffff;
    }

    .tse-dash-tabs {
      display: flex;
      gap: 22px;
    }

    .tse-dash-tab {
      background: transparent;
      border: none;
      padding: 8px 0 10px 0;
      color: #888888;
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      position: relative;
      transition: color 0.12s ease;
      font-family: inherit;
      outline: none;
    }
    .tse-dash-tab:hover {
      color: #cccccc;
    }
    .tse-dash-tab.active {
      color: #ffffff;
      font-weight: 600;
    }
    .tse-dash-tab.active::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: #ffffff;
      border-radius: 2px;
    }

    /* Body scrollable area */
    .tse-dash-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .tse-dash-body::-webkit-scrollbar {
      width: 6px;
    }
    .tse-dash-body::-webkit-scrollbar-track {
      background: transparent;
    }
    .tse-dash-body::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 999px;
    }

    /* Tab panels (for 0ms instant display toggling) */
    .tse-tab-panel {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
    }

    /* Section card matching Timestripe dark style */
    .tse-card {
      background: #161618;
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .tse-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .tse-card-title {
      font-size: 13px;
      font-weight: 600;
      color: #ffffff;
    }

    .tse-card-desc {
      font-size: 12px;
      color: #8e8e93;
      line-height: 1.45;
    }

    /* Sleek buttons matching Timestripe UI */
    .tse-btn-primary {
      background: #ffffff;
      color: #121214;
      border: none;
      border-radius: 7px;
      padding: 8px 16px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.12s ease;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .tse-btn-primary:hover:not(:disabled) {
      background: #e4e4e7;
    }
    .tse-btn-primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .tse-btn-secondary {
      background: #252528;
      color: #f4f4f5;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 7px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tse-btn-secondary:hover {
      background: #2f2f33;
      border-color: rgba(255, 255, 255, 0.2);
    }

    .tse-btn-icon-del {
      background: transparent;
      color: #71717a;
      border: none;
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.12s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .tse-btn-icon-del:hover {
      color: #f87171;
      background: rgba(239, 68, 68, 0.12);
    }

    /* Form Controls */
    .tse-input {
      width: 100%;
      background: #101012;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 7px;
      padding: 8px 12px;
      color: #ffffff;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.12s ease;
    }
    .tse-input:focus {
      border-color: rgba(255, 255, 255, 0.4);
    }

    /* Project items in list */
    .tse-project-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: #1f1f22;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      transition: all 0.12s ease;
    }
    .tse-project-row:hover {
      background: #252528;
      border-color: rgba(255, 255, 255, 0.12);
    }

    .tse-project-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .tse-project-name {
      flex: 1;
      min-width: 0;
      font-size: 13.5px;
      font-weight: 500;
      color: #ffffff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tse-project-pill {
      font-size: 11px;
      color: #8e8e93;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 2px 7px;
      border-radius: 6px;
      flex-shrink: 0;
      white-space: nowrap;
    }

    .tse-scope-select {
      background: #141416;
      color: #e4e4e7;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 500;
      padding: 3px 7px;
      cursor: pointer;
      outline: none;
      flex-shrink: 0;
    }

    /* High-contrast, clean Chips (NO invisible white-on-white text!) */
    .tse-chip-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .tse-chip {
      background: #202024;
      color: #a1a1aa;
      border: 1px solid rgba(255, 255, 255, 0.12);
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.12s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    }
    .tse-chip:hover {
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.25);
      background: #28282c;
    }
    .tse-chip.active {
      background: #2a2a2e !important;
      color: #ffffff !important;
      border: 1.5px solid #ffffff !important;
      font-weight: 600;
      box-shadow: 0 0 10px rgba(255, 255, 255, 0.15);
    }

    /* Color Swatches */
    .tse-swatches {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tse-swatch {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.12s ease;
    }
    .tse-swatch:hover {
      transform: scale(1.15);
    }
    .tse-swatch.selected {
      border-color: #ffffff;
      box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.6);
    }

    /* Appearance Cards */
    .tse-mode-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .tse-mode-card {
      background: #1f1f22;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.12s ease;
    }
    .tse-mode-card:hover {
      background: #252528;
    }
    .tse-mode-card.selected {
      border-color: rgba(255, 255, 255, 0.4);
      background: #242427;
      box-shadow: 0 0 12px rgba(255, 255, 255, 0.05);
    }

    /* Editable project row controls (color dot + rename pencil) */
    .tse-project-dot-btn {
      background: transparent;
      border: none;
      padding: 3px;
      border-radius: 50%;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }
    .tse-project-dot-btn:hover {
      transform: scale(1.2);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
    }
    .tse-icon-btn {
      background: transparent;
      border: none;
      color: #71717a;
      font-size: 13px;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 5px;
      flex-shrink: 0;
      transition: all 0.12s ease;
      line-height: 1;
    }
    .tse-icon-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
    }
    .tse-rename-input {
      flex: 1;
      min-width: 0;
      padding: 3px 8px !important;
      font-size: 13px !important;
    }

    /* Color picker popover */
    .tse-color-pop {
      position: fixed;
      z-index: 2147483647;
      background: #1f1f22;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      padding: 10px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      gap: 10px;
      animation: tseFadeIn 0.1s ease-out;
    }
    .tse-color-pop-grid {
      display: grid;
      grid-template-columns: repeat(4, 26px);
      gap: 7px;
    }
    .tse-color-pop-swatch {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.2);
      cursor: pointer;
      transition: transform 0.1s ease;
      padding: 0;
    }
    .tse-color-pop-swatch:hover {
      transform: scale(1.15);
    }
    .tse-color-pop-swatch.selected {
      border-color: #ffffff;
      box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.6);
    }
    .tse-color-pop-custom {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .tse-color-pop-custom input[type="color"] {
      width: 30px;
      height: 30px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
    }
    .tse-color-hex {
      width: 92px;
      padding: 5px 8px !important;
      font-size: 12px !important;
      font-family: monospace;
    }
    .tse-color-apply {
      padding: 6px 12px !important;
      font-size: 12px !important;
    }
  `;
  document.head.appendChild(style);
}

export function closeDashboardModal(): void {
  if (activeModalEl) {
    activeModalEl.remove();
    activeModalEl = null;
  }
}

export function toggleDashboardModal(): void {
  if (activeModalEl) {
    closeDashboardModal();
  } else {
    void openDashboardModal();
  }
}

/** Multi-strategy detector to find Timestripe's sidebar bottom section and insert our icon */
function findSidebarBottomTarget(): { container: HTMLElement; insertBeforeEl: HTMLElement | null } | null {
  // Purge any trigger mistakenly placed near Templates in the middle of the screen
  const existing = document.getElementById("tse-sidebar-trigger");
  if (existing) {
    const r = existing.getBoundingClientRect();
    if (r.top < window.innerHeight - 250) {
      existing.remove();
    } else {
      return null; // Already correctly placed at the bottom!
    }
  }

  // Strictly target elements docked on the left edge (x < 65px) in the bottom cluster (top > window.innerHeight - 250px)
  const bottomItems = Array.from(
    document.querySelectorAll<HTMLElement>("button, a, [role='button'], div"),
  ).filter((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.left >= 0 &&
      r.left < 65 &&
      r.width >= 20 &&
      r.width <= 50 &&
      r.height >= 20 &&
      r.height <= 50 &&
      r.top > window.innerHeight - 250
    );
  });

  if (bottomItems.length === 0) return null;

  // Sort ascending by vertical position (top)
  bottomItems.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  // In Timestripe (Image 2 & 3), the bottom cluster is:
  // [ ⊕ ]        <-- bottomItems[0] (topmost of bottom items)
  // [ Search ]
  // [ Settings ]
  // [ Collapse ]
  const plusBtn = bottomItems[0];
  return {
    container: plusBtn.parentElement ?? plusBtn,
    insertBeforeEl: plusBtn,
  };
}

/** Injects our native-matching sidebar button right above the "+" button */
export function injectSidebarButton(): void {
  injectDashboardStyles();

  if (document.getElementById("tse-sidebar-trigger")) return;

  const target = findSidebarBottomTarget();
  if (!target || !target.container) {
    // Retry periodically for 5 seconds on slow SPA initial render
    if (!sidebarRetryInterval) {
      let attempts = 0;
      sidebarRetryInterval = setInterval(() => {
        attempts++;
        if (document.getElementById("tse-sidebar-trigger") || attempts > 10) {
          if (sidebarRetryInterval) clearInterval(sidebarRetryInterval);
          sidebarRetryInterval = null;
        } else {
          injectSidebarButton();
        }
      }, 500);
    }
    return;
  }

  if (sidebarRetryInterval) {
    clearInterval(sidebarRetryInterval);
    sidebarRetryInterval = null;
  }

  const myBtn = document.createElement("button");
  myBtn.id = "tse-sidebar-trigger";
  myBtn.type = "button";
  myBtn.className = "tse-sidebar-btn";
  myBtn.title = "Timestripe Enhancement (Press KK)";
  myBtn.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
    </svg>
  `;

  myBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDashboardModal();
  };

  if (target.insertBeforeEl && target.insertBeforeEl.parentElement === target.container) {
    target.container.insertBefore(myBtn, target.insertBeforeEl);
  } else {
    target.container.prepend(myBtn);
  }
}

/** Global listener for double "K" (or Arabic "ن", e.code === "KeyK") shortcut */
export function initDashboardShortcut(): void {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeModalEl) {
      closeDashboardModal();
      return;
    }

    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable) ||
      active?.closest(".ProseMirror, [contenteditable='true']")
    ) {
      return;
    }

    if (e.code === "KeyK" || e.key.toLowerCase() === "k" || e.key === "ن") {
      const now = Date.now();
      if (now - lastKeyKTime < 450) {
        e.preventDefault();
        e.stopPropagation();
        lastKeyKTime = 0;
        toggleDashboardModal();
      } else {
        lastKeyKTime = now;
      }
    }
  });
}

/** Opens the native-styled full dashboard dialog inside the page */
export async function openDashboardModal(): Promise<void> {
  injectDashboardStyles();
  closeDashboardModal();

  // Purge any stray full-screen backdrops left behind by a previous modal
  // (scheduler / duplicate / delete). A leftover one sits above the dashboard
  // and silently swallows every click, making the UI look "frozen".
  document.querySelectorAll(".tse-modal-backdrop").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "tse-dash-overlay";
  activeModalEl = overlay;

  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) closeDashboardModal();
    e.stopPropagation();
  });
  overlay.addEventListener("mousedown", (e) => e.stopPropagation());
  overlay.addEventListener("mouseup", (e) => e.stopPropagation());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDashboardModal();
    e.stopPropagation();
  });

  const box = document.createElement("div");
  box.className = "tse-dash-box";
  box.addEventListener("pointerdown", (e) => e.stopPropagation());
  box.addEventListener("mousedown", (e) => e.stopPropagation());
  box.addEventListener("mouseup", (e) => e.stopPropagation());
  box.addEventListener("click", (e) => e.stopPropagation());

  // Header
  const header = document.createElement("div");
  header.className = "tse-dash-header";

  const topbar = document.createElement("div");
  topbar.className = "tse-dash-topbar";

  const title = document.createElement("div");
  title.className = "tse-dash-title";
  title.innerHTML = `
    <span style="display:inline-flex;width:8px;height:8px;border-radius:50%;background:#ffffff;"></span>
    <span>Timestripe Enhancement</span>
    <span style="font-size:11px;color:#8e8e93;font-weight:400;margin-inline-start:4px;">(KK)</span>
  `;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tse-dash-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.title = "Close (Esc)";
  bindActivate(closeBtn, closeDashboardModal);

  topbar.append(title, closeBtn);

  // Tabs Bar
  const tabsBar = document.createElement("div");
  tabsBar.className = "tse-dash-tabs";

  const makeTab = (id: typeof currentTab, label: string) => {
    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.className = currentTab === id ? "tse-dash-tab active" : "tse-dash-tab";
    tabBtn.textContent = label;
    bindActivate(tabBtn, () => switchTab(id));
    return tabBtn;
  };

  const tabProjects = makeTab("projects", "Projects");
  const tabSettings = makeTab("settings", "Settings & Appearance");
  const tabTemplates = makeTab("templates", "Templates");

  tabsBar.append(tabProjects, tabSettings, tabTemplates);
  header.append(topbar, tabsBar);
  box.appendChild(header);

  // Body container hosting pre-rendered panels
  const body = document.createElement("div");
  body.className = "tse-dash-body";

  const panelProjects = document.createElement("div");
  panelProjects.id = "tse-panel-projects";
  panelProjects.className = "tse-tab-panel";

  const panelSettings = document.createElement("div");
  panelSettings.id = "tse-panel-settings";
  panelSettings.className = "tse-tab-panel";
  panelSettings.style.display = "none";

  const panelTemplates = document.createElement("div");
  panelTemplates.id = "tse-panel-templates";
  panelTemplates.className = "tse-tab-panel";
  panelTemplates.style.display = "none";

  body.append(panelProjects, panelSettings, panelTemplates);
  box.appendChild(body);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // 0ms instant initial render from in-memory state
  renderProjectsPanel(panelProjects, getProjects(), cachedSpaces, getViewState());
  renderSettingsPanel(panelSettings, getSettings(), cachedSpaces);
  renderTemplatesPanel(panelTemplates, cachedTemplates);

  // Fetch latest background state asynchronously and refresh without blocking UI
  void syncBackgroundData(panelProjects, panelSettings, panelTemplates);
}

/** 0ms Instant Client-Side Tab Switcher */
function switchTab(tabId: typeof currentTab): void {
  currentTab = tabId;
  if (!activeModalEl) return;

  // Toggle tab buttons
  const tabs = activeModalEl.querySelectorAll<HTMLElement>(".tse-dash-tab");
  tabs.forEach((tab) => {
    const text = (tab.textContent ?? "").toLowerCase();
    const isAct =
      (tabId === "projects" && text.includes("projects")) ||
      (tabId === "settings" && text.includes("settings")) ||
      (tabId === "templates" && text.includes("templates"));
    tab.classList.toggle("active", isAct);
  });

  // Toggle panels instantaneously (0ms)
  const pProj = activeModalEl.querySelector<HTMLElement>("#tse-panel-projects");
  const pSet = activeModalEl.querySelector<HTMLElement>("#tse-panel-settings");
  const pTpl = activeModalEl.querySelector<HTMLElement>("#tse-panel-templates");

  if (pProj) pProj.style.display = tabId === "projects" ? "flex" : "none";
  if (pSet) pSet.style.display = tabId === "settings" ? "flex" : "none";
  if (pTpl) pTpl.style.display = tabId === "templates" ? "flex" : "none";
}

async function syncBackgroundData(
  panelProjects: HTMLElement,
  panelSettings: HTMLElement,
  panelTemplates: HTMLElement,
): Promise<void> {
  const [spacesRes, projectsRes, viewRes, templatesRes] = await Promise.all([
    sendToBg<TSSpace[]>({ type: "LIST_SPACES" }),
    sendToBg<Project[]>({ type: "GET_PROJECTS" }),
    sendToBg<ViewState>({ type: "GET_VIEW_STATE" }),
    sendToBg<GoalTemplate[]>({ type: "LIST_TEMPLATES" }),
  ]);

  if (spacesRes?.ok && spacesRes.data) cachedSpaces = spacesRes.data;
  if (templatesRes?.ok && templatesRes.data) cachedTemplates = templatesRes.data;

  const projects = projectsRes?.ok && projectsRes.data ? projectsRes.data : getProjects();
  const viewState = viewRes?.ok && viewRes.data ? viewRes.data : getViewState();
  const settings = viewState.settings;

  renderProjectsPanel(panelProjects, projects, cachedSpaces, viewState);
  renderSettingsPanel(panelSettings, settings, cachedSpaces);
  renderTemplatesPanel(panelTemplates, cachedTemplates);
}

function renderProjectsPanel(
  panel: HTMLElement,
  projects: Project[],
  spaces: TSSpace[],
  viewState: ViewState,
): void {
  // If panel already has content, only update the projects list and space chips
  const existingListCard = panel.querySelector<HTMLElement>("#tse-projects-items-card");
  if (existingListCard) {
    updateProjectsList(existingListCard, projects, spaces, viewState);
    const existingScopeRow = panel.querySelector<HTMLElement>("#tse-new-project-scopes");
    if (existingScopeRow) {
      syncSpaceChips(existingScopeRow, spaces);
    }
    return;
  }

  panel.innerHTML = "";

  // 1. Projects List Card
  const listCard = document.createElement("div");
  listCard.id = "tse-projects-items-card";
  listCard.className = "tse-card";
  panel.appendChild(listCard);
  updateProjectsList(listCard, projects, spaces, viewState);

  // 2. Add New Project Card
  const newCard = document.createElement("div");
  newCard.className = "tse-card";

  const newTitle = document.createElement("span");
  newTitle.className = "tse-card-title";
  newTitle.textContent = "New Project";
  newCard.appendChild(newTitle);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tse-input";
  input.placeholder = "Project name (e.g. Work, Study, Health)";

  // Scope selection chips (High-Contrast, Instant Visual Feedback)
  const scopeRow = document.createElement("div");
  scopeRow.id = "tse-new-project-scopes";
  scopeRow.className = "tse-chip-row";

  const scopeLabel = document.createElement("span");
  scopeLabel.style.fontSize = "12px";
  scopeLabel.style.color = "#8e8e93";
  scopeLabel.textContent = "Scope:";
  scopeRow.appendChild(scopeLabel);

  const globalChip = document.createElement("button");
  globalChip.type = "button";
  globalChip.className = newProjectScope === "global" ? "tse-chip active" : "tse-chip";
  globalChip.dataset.scope = "global";
  globalChip.textContent = "🌐 Global (All Spaces)";
  bindActivate(globalChip, () => setScopeSelection(scopeRow, "global"));
  scopeRow.appendChild(globalChip);

  syncSpaceChips(scopeRow, spaces);

  // Color selection swatches
  const swatchRow = document.createElement("div");
  swatchRow.className = "tse-swatches";

  for (const c of QUICK_COLORS) {
    const s = document.createElement("button");
    s.type = "button";
    s.className = c === newProjectColor ? "tse-swatch selected" : "tse-swatch";
    s.style.background = c;
    bindActivate(s, () => {
      newProjectColor = c;
      swatchRow.querySelectorAll(".tse-swatch").forEach((el) => el.classList.remove("selected"));
      s.classList.add("selected");
    });
    swatchRow.appendChild(s);
  }

  // Right-aligned sleek primary button (matching Timestripe)
  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.justifyContent = "flex-end";
  btnRow.style.marginTop = "4px";

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "tse-btn-primary";
  createBtn.textContent = "Add Project";
  bindActivate(createBtn, () => {
    void (async () => {
      const val = input.value.trim();
      if (!val) return;
      await sendToBg({
        type: "CREATE_PROJECT",
        name: val,
        color: newProjectColor,
        spaceId: newProjectScope === "global" ? null : newProjectScope,
      });
      input.value = "";
      showToast(`Created project "${val}"`);
      const updated = await sendToBg<Project[]>({ type: "GET_PROJECTS" });
      if (updated?.ok && updated.data) {
        updateProjectsList(listCard, updated.data, spaces, viewState);
      }
    })();
  });

  input.onkeydown = (e) => {
    if (e.key === "Enter") void createBtn.click();
  };

  btnRow.appendChild(createBtn);
  newCard.append(input, scopeRow, swatchRow, btnRow);
  panel.appendChild(newCard);
}

function syncSpaceChips(scopeRow: HTMLElement, spaces: TSSpace[]): void {
  const existingScopes = Array.from(scopeRow.querySelectorAll<HTMLElement>(".tse-chip[data-scope]"))
    .map((el) => el.dataset.scope);

  for (const s of spaces) {
    if (existingScopes.includes(s.id)) continue;
    const c = document.createElement("button");
    c.type = "button";
    c.className = newProjectScope === s.id ? "tse-chip active" : "tse-chip";
    c.dataset.scope = s.id;
    c.textContent = s.name;
    bindActivate(c, () => setScopeSelection(scopeRow, s.id));
    scopeRow.appendChild(c);
  }

  // Ensure current active chip style is applied
  setScopeSelection(scopeRow, newProjectScope);
}

function setScopeSelection(scopeRow: HTMLElement, targetScope: string): void {
  newProjectScope = targetScope;
  const chips = scopeRow.querySelectorAll<HTMLElement>(".tse-chip[data-scope]");
  chips.forEach((chip) => {
    const isAct = chip.dataset.scope === targetScope;
    chip.classList.toggle("active", isAct);
    if (isAct) {
      chip.style.setProperty("background", "#2a2a2e", "important");
      chip.style.setProperty("color", "#ffffff", "important");
      chip.style.setProperty("border-color", "#ffffff", "important");
      chip.style.setProperty("font-weight", "600", "important");
      chip.style.setProperty("box-shadow", "0 0 10px rgba(255, 255, 255, 0.15)", "important");
    } else {
      chip.style.setProperty("background", "#202024", "important");
      chip.style.setProperty("color", "#a1a1aa", "important");
      chip.style.setProperty("border-color", "rgba(255, 255, 255, 0.12)", "important");
      chip.style.setProperty("font-weight", "500", "important");
      chip.style.removeProperty("box-shadow");
    }
  });
}

function updateProjectsList(
  listCard: HTMLElement,
  projects: Project[],
  spaces: TSSpace[],
  viewState: ViewState,
): void {
  listCard.innerHTML = "";

  const taskCounts = new Map<string, number>();
  for (const a of Object.values(viewState.assignments)) {
    taskCounts.set(a.projectId, (taskCounts.get(a.projectId) ?? 0) + 1);
  }

  const listHeader = document.createElement("div");
  listHeader.className = "tse-card-header";

  const title = document.createElement("span");
  title.className = "tse-card-title";
  title.textContent = `Projects (${projects.length})`;
  listHeader.appendChild(title);
  listCard.appendChild(listHeader);

  if (projects.length === 0) {
    const emptyP = document.createElement("p");
    emptyP.className = "tse-card-desc";
    emptyP.textContent = "No projects yet. Create one below to color code and organize your goals.";
    listCard.appendChild(emptyP);
    return;
  }

  const itemsContainer = document.createElement("div");
  itemsContainer.style.display = "flex";
  itemsContainer.style.flexDirection = "column";
  itemsContainer.style.gap = "6px";
  itemsContainer.style.maxHeight = "230px";
  itemsContainer.style.overflowY = "auto";

  for (const p of projects) {
    const row = document.createElement("div");
    row.className = "tse-project-row";

    // Color dot = edit-color button (opens palette popover)
    const dotBtn = document.createElement("button");
    dotBtn.type = "button";
    dotBtn.className = "tse-project-dot-btn";
    dotBtn.title = "Change project color";
    const dot = document.createElement("span");
    dot.className = "tse-project-dot";
    dot.style.background = p.color;
    dotBtn.appendChild(dot);
    bindActivate(dotBtn, () => {
      openColorPopover(dotBtn, p.color, (color) => {
        void (async () => {
          await sendToBg({ type: "UPDATE_PROJECT", project: { ...p, color } });
          dot.style.background = color;
          showToast(`Color updated for "${p.name}"`);
        })();
      });
    });

    const name = document.createElement("span");
    name.className = "tse-project-name";
    name.textContent = p.name;
    name.title = p.name;
    name.setAttribute("dir", "auto");

    // Pencil = inline rename
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "tse-icon-btn";
    renameBtn.title = "Rename project";
    renameBtn.textContent = "✎";
    bindActivate(renameBtn, () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tse-input tse-rename-input";
      input.value = p.name;
      input.setAttribute("dir", "auto");
      name.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (next && next !== p.name) {
          void (async () => {
            await sendToBg({ type: "UPDATE_PROJECT", project: { ...p, name: next } });
            p.name = next;
            showToast(`Renamed to "${next}"`);
          })();
        }
        name.textContent = next || p.name;
        name.title = next || p.name;
        input.replaceWith(name);
      };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          commit();
        } else if (ev.key === "Escape") {
          done = true;
          input.replaceWith(name);
        }
      });
      input.addEventListener("blur", commit);
      input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    });

    // Scope select
    const select = document.createElement("select");
    select.className = "tse-scope-select";
    select.innerHTML = `
      <option value="global" ${!p.spaceId || p.spaceId === "global" ? "selected" : ""}>🌐 Global</option>
      ${spaces.map((s) => `<option value="${s.id}" ${p.spaceId === s.id ? "selected" : ""}>${s.name}</option>`).join("")}
    `;
    select.onchange = async () => {
      const nextScope = select.value === "global" ? null : select.value;
      await sendToBg({ type: "UPDATE_PROJECT", project: { ...p, spaceId: nextScope } });
      const updated = await sendToBg<Project[]>({ type: "GET_PROJECTS" });
      if (updated?.ok && updated.data) {
        updateProjectsList(listCard, updated.data, spaces, viewState);
      }
    };

    const countPill = document.createElement("span");
    countPill.className = "tse-project-pill";
    countPill.textContent = `${taskCounts.get(p.id) ?? 0} tasks`;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "tse-btn-icon-del";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "Delete Project";
    deleteBtn.onclick = async () => {
      if (confirm(`Delete project "${p.name}"?`)) {
        await sendToBg({ type: "DELETE_PROJECT", projectId: p.id });
        const updated = await sendToBg<Project[]>({ type: "GET_PROJECTS" });
        if (updated?.ok && updated.data) {
          updateProjectsList(listCard, updated.data, spaces, viewState);
        }
      }
    };

    row.append(dotBtn, name, renameBtn, select, countPill, deleteBtn);
    itemsContainer.appendChild(row);
  }

  listCard.appendChild(itemsContainer);
}

function renderSettingsPanel(
  panel: HTMLElement,
  settings: Settings,
  spaces: TSSpace[],
): void {
  panel.innerHTML = "";

  // 1. Active Space Card
  const spaceCard = document.createElement("div");
  spaceCard.className = "tse-card";
  spaceCard.innerHTML = `
    <span class="tse-card-title">Active Space</span>
    <p class="tse-card-desc">Projects, colors and mappings are scoped to this space.</p>
  `;

  const chipsRow = document.createElement("div");
  chipsRow.className = "tse-chip-row";

  function updateActiveSpaceUI(targetSpaceId: string): void {
    const chips = chipsRow.querySelectorAll<HTMLElement>(".tse-chip[data-space]");
    chips.forEach((c) => {
      const isAct = c.dataset.space === targetSpaceId;
      c.classList.toggle("active", isAct);
      if (isAct) {
        c.style.setProperty("background", "#2a2a2e", "important");
        c.style.setProperty("color", "#ffffff", "important");
        c.style.setProperty("border-color", "#ffffff", "important");
        c.style.setProperty("font-weight", "600", "important");
        c.style.setProperty("box-shadow", "0 0 10px rgba(255, 255, 255, 0.15)", "important");
      } else {
        c.style.setProperty("background", "#202024", "important");
        c.style.setProperty("color", "#a1a1aa", "important");
        c.style.setProperty("border-color", "rgba(255, 255, 255, 0.12)", "important");
        c.style.setProperty("font-weight", "500", "important");
        c.style.removeProperty("box-shadow");
      }
    });
  }

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.dataset.space = "all";
  allChip.className = settings.activeSpaceId === "all" ? "tse-chip active" : "tse-chip";
  allChip.textContent = "🌐 All Spaces";
  bindActivate(allChip, () => {
    updateActiveSpaceUI("all");
    void (async () => {
      await sendToBg({ type: "SET_ACTIVE_SPACE", spaceId: "all" });
      showToast("Active Space: All Spaces");
    })();
  });
  chipsRow.appendChild(allChip);

  for (const s of spaces) {
    const sc = document.createElement("button");
    sc.type = "button";
    sc.dataset.space = s.id;
    sc.className = settings.activeSpaceId === s.id ? "tse-chip active" : "tse-chip";
    sc.textContent = s.name;
    bindActivate(sc, () => {
      updateActiveSpaceUI(s.id);
      void (async () => {
        await sendToBg({ type: "SET_ACTIVE_SPACE", spaceId: s.id });
        showToast(`Active Space: ${s.name}`);
      })();
    });
    chipsRow.appendChild(sc);
  }

  updateActiveSpaceUI(settings.activeSpaceId ?? "all");

  spaceCard.appendChild(chipsRow);
  panel.appendChild(spaceCard);

  // 2. Appearance & Indicators Card
  const appCard = document.createElement("div");
  appCard.className = "tse-card";
  appCard.innerHTML = `
    <span class="tse-card-title">Appearance & Indicators</span>
  `;

  const modeGrid = document.createElement("div");
  modeGrid.className = "tse-mode-grid";

  const stripCard = document.createElement("div");
  stripCard.className = settings.colorMode === "strip" ? "tse-mode-card selected" : "tse-mode-card";
  stripCard.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-weight:600;font-size:12.5px;">
      <span>Strip Mode</span>
      <span class="tse-check-mark" style="${settings.colorMode === "strip" ? "" : "display:none;"}">✓</span>
    </div>
    <div style="height:6px;background:#252528;border-left:4px solid #00A8FF;border-radius:2px;margin:4px 0;"></div>
    <span style="font-size:11px;color:#8e8e93;">Subtle edge jewel</span>
  `;
  bindActivate(stripCard, () => {
    void (async () => {
      await sendToBg({ type: "SET_SETTINGS", patch: { colorMode: "strip" } });
      fullCard.classList.remove("selected");
      fullCard.querySelector<HTMLElement>(".tse-check-mark")!.style.display = "none";
      stripCard.classList.add("selected");
      stripCard.querySelector<HTMLElement>(".tse-check-mark")!.style.display = "inline";
    })();
  });

  const fullCard = document.createElement("div");
  fullCard.className = settings.colorMode === "full" ? "tse-mode-card selected" : "tse-mode-card";
  fullCard.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-weight:600;font-size:12.5px;">
      <span>Full Color</span>
      <span class="tse-check-mark" style="${settings.colorMode === "full" ? "" : "display:none;"}">✓</span>
    </div>
    <div style="height:6px;background:rgba(0,168,255,0.2);border-radius:2px;margin:4px 0;"></div>
    <span style="font-size:11px;color:#8e8e93;">Soft background tint</span>
  `;
  bindActivate(fullCard, () => {
    void (async () => {
      await sendToBg({ type: "SET_SETTINGS", patch: { colorMode: "full" } });
      stripCard.classList.remove("selected");
      stripCard.querySelector<HTMLElement>(".tse-check-mark")!.style.display = "none";
      fullCard.classList.add("selected");
      fullCard.querySelector<HTMLElement>(".tse-check-mark")!.style.display = "inline";
    })();
  });

  modeGrid.append(stripCard, fullCard);
  appCard.appendChild(modeGrid);

  // Toggle show badge
  const toggleLabel = document.createElement("label");
  toggleLabel.style.display = "flex";
  toggleLabel.style.alignItems = "center";
  toggleLabel.style.justifyContent = "space-between";
  toggleLabel.style.cursor = "pointer";
  toggleLabel.style.fontSize = "12.5px";
  toggleLabel.innerHTML = `
    <span>Show project name badge on tasks</span>
    <input type="checkbox" ${settings.showProjectName ? "checked" : ""} style="cursor:pointer;" />
  `;
  const chk = toggleLabel.querySelector("input");
  if (chk) {
    chk.onchange = async () => {
      await sendToBg({ type: "SET_SETTINGS", patch: { showProjectName: chk.checked } });
    };
  }
  appCard.appendChild(toggleLabel);
  panel.appendChild(appCard);

  // 3. Backup & Restore Card
  const backupCard = document.createElement("div");
  backupCard.className = "tse-card";
  backupCard.innerHTML = `
    <span class="tse-card-title">Backup & Restore</span>
    <p class="tse-card-desc">Export or import your projects, colors, and configuration via JSON file or direct text.</p>
  `;

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "8px";
  btnRow.style.flexWrap = "wrap";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "tse-btn-secondary";
  downloadBtn.textContent = "Download .json";
  bindActivate(downloadBtn, () => {
    void (async () => {
      const res = await sendToBg<BackupPayload>({ type: "EXPORT_BACKUP" });
      if (!res?.ok || !res.data) return;
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `timestripe-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Backup exported successfully");
    })();
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "tse-btn-secondary";
  copyBtn.textContent = "📋 Copy JSON";
  bindActivate(copyBtn, () => {
    void (async () => {
      const res = await sendToBg<BackupPayload>({ type: "EXPORT_BACKUP" });
      if (!res?.ok || !res.data) return;
      await navigator.clipboard.writeText(JSON.stringify(res.data, null, 2));
      showToast("📋 Backup JSON copied to clipboard!");
    })();
  });

  const pasteBtn = document.createElement("button");
  pasteBtn.type = "button";
  pasteBtn.className = "tse-btn-secondary";
  pasteBtn.textContent = "📝 Paste JSON";
  bindActivate(pasteBtn, () => openInModalPasteBox(panel));

  btnRow.append(downloadBtn, copyBtn, pasteBtn);
  backupCard.appendChild(btnRow);
  panel.appendChild(backupCard);
}

function openInModalPasteBox(parent: HTMLElement): void {
  const existing = parent.querySelector("#tse-inline-pastebox");
  if (existing) {
    existing.remove();
    return;
  }

  const pasteBox = document.createElement("div");
  pasteBox.id = "tse-inline-pastebox";
  pasteBox.style.marginTop = "12px";
  pasteBox.style.padding = "14px";
  pasteBox.style.background = "#141416";
  pasteBox.style.borderRadius = "8px";
  pasteBox.style.border = "1px solid rgba(255, 255, 255, 0.12)";
  pasteBox.style.display = "flex";
  pasteBox.style.flexDirection = "column";
  pasteBox.style.gap = "10px";

  const ta = document.createElement("textarea");
  ta.rows = 5;
  ta.className = "tse-input";
  ta.placeholder = 'Paste JSON here... e.g. { "data": { "projects": [...] } }';
  ta.style.fontFamily = "monospace";
  ta.style.fontSize = "11.5px";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.justifyContent = "flex-end";
  actions.style.gap = "8px";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "tse-btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => pasteBox.remove();

  const doImport = document.createElement("button");
  doImport.type = "button";
  doImport.className = "tse-btn-primary";
  doImport.textContent = "Import Now";
  doImport.onclick = async () => {
    try {
      const parsed = JSON.parse(ta.value.trim());
      const payload: BackupPayload = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        spaceId: "global",
        data: parsed.data ?? parsed,
      };
      const res = await sendToBg<{ restoredProjects: number }>({
        type: "IMPORT_BACKUP",
        payload,
        mode: "merge",
      });
      if (res?.ok) {
        showToast("Restored backup successfully!");
        pasteBox.remove();
      }
    } catch (e) {
      alert(`Invalid JSON: ${String(e)}`);
    }
  };

  actions.append(cancelBtn, doImport);
  pasteBox.append(ta, actions);
  parent.appendChild(pasteBox);
}

function renderTemplatesPanel(panel: HTMLElement, templates: GoalTemplate[]): void {
  panel.innerHTML = "";

  const tplCard = document.createElement("div");
  tplCard.className = "tse-card";
  tplCard.innerHTML = `
    <span class="tse-card-title">Goal Templates</span>
    <p class="tse-card-desc">Reusable multi-level goal trees. You can save any selection as a template using the selection bar.</p>
  `;

  if (templates.length === 0) {
    const emptyP = document.createElement("p");
    emptyP.className = "tse-card-desc";
    emptyP.textContent = "No templates saved yet. Select tasks on the board and click 'Save Template' in the floating selection bar.";
    tplCard.appendChild(emptyP);
  } else {
    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "8px";

    for (const t of templates) {
      const row = document.createElement("div");
      row.className = "tse-project-row";

      const title = document.createElement("span");
      title.className = "tse-project-name";
      title.textContent = t.name;

      const nodesPill = document.createElement("span");
      nodesPill.className = "tse-project-pill";
      nodesPill.textContent = `${t.nodes.length} nodes`;

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "tse-btn-icon-del";
      delBtn.textContent = "✕";
      delBtn.onclick = async () => {
        if (confirm(`Delete template "${t.name}"?`)) {
          await sendToBg({ type: "DELETE_TEMPLATE", templateId: t.id });
          const res = await sendToBg<GoalTemplate[]>({ type: "LIST_TEMPLATES" });
          renderTemplatesPanel(panel, res?.ok && res.data ? res.data : []);
        }
      };

      row.append(title, nodesPill, delBtn);
      list.appendChild(row);
    }
    tplCard.appendChild(list);
  }

  panel.appendChild(tplCard);
}
