/**
 * Injects a "Project" entry (with flyout) into Timestripe's native goal "..." menu (PRD §55).
 * The native menu is a portal rendered on demand; we detect it, remember which goal it
 * belongs to (the clicked row / the open modal route), and add our section.
 *
 * Flyout lifecycle:
 * - Opens on hover over the "Project ›" row.
 * - Bridges across the gap with a 180ms grace window.
 * - Stays open while mouse is inside the flyout.
 * - Closes on mouseleave, when hovering other parent menu items, or when the parent menu disappears.
 */

import { showToast } from "./toast";
import { sendToBg } from "./messaging";
import {
  getProjects,
  getTaskTextConfigs,
  getViewState,
  optimisticAssign,
  optimisticColorOverride,
  optimisticTextConfig,
} from "./state";
import { openDuplicateModal } from "./duplicate-modal";
import { openTemplatesModal } from "./templates-modal";
import { pushAction } from "./history";
import type { TaskTextConfig } from "../shared/types";

const MENU_SIGNATURE = ["Duplicate", "Delete"];
const SECTION_CLASS = "tse-menu-section";
const FLYOUT_CLASS = "tse-flyout";

const QUICK_COLOR_SWATCHES = [
  "#FFFFFF", "#D6D6D6", "#8A8A8A", "#262626", "#18181B",
  "#F000F0", "#9013FE", "#2D2DE8", "#00A8FF", "#00E676",
  "#AEEA00", "#FFEA00", "#FF9100", "#FF3D00", "#C62828",
  "#F48FB1", "#CE93D8", "#90CAF9", "#80CBC4", "#FFE082",
];

let pendingGoalId: string | null = null;
const processedMenus = new WeakSet<Element>();

let activeFlyout: HTMLElement | null = null;
let activeParentMenu: Element | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function cancelCloseTimer(): void {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

export function closeFlyouts(): void {
  cancelCloseTimer();
  if (activeFlyout) {
    activeFlyout.remove();
    activeFlyout = null;
  }
  activeParentMenu = null;
}

function scheduleCloseFlyout(delayMs = 180): void {
  cancelCloseTimer();
  closeTimer = setTimeout(() => {
    closeFlyouts();
  }, delayMs);
}

// Global cleanup: click outside, Escape, scroll or resize dismisses any hanging flyout.
document.addEventListener(
  "pointerdown",
  (e) => {
    const target = e.target as Element | null;
    if (activeFlyout && !target?.closest(`.${FLYOUT_CLASS}`) && !target?.closest(`.${SECTION_CLASS}`)) {
      closeFlyouts();
    }
  },
  true,
);

window.addEventListener("scroll", () => closeFlyouts(), { passive: true, capture: true });
window.addEventListener("resize", () => closeFlyouts(), { passive: true });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeFlyouts();
});

function goalIdFromLocation(): string | null {
  return /^\/goals\/([A-Za-z0-9]{8})/.exec(location.pathname)?.[1] ?? null;
}

/** Remember which goal the last click belonged to — the "..." trigger or the open modal. */
export function captureMenuTarget(target: EventTarget | null): void {
  const el = target instanceof Element ? target : null;
  const wrapper = el?.closest<HTMLElement>(".GoalRowWrapper");
  pendingGoalId =
    wrapper
      ? (wrapper.getAttribute("data-draggable-id") ?? "").match(/::goal:([A-Za-z0-9]{8})$/)?.[1] ?? null
      : null;
  if (!pendingGoalId) pendingGoalId = goalIdFromLocation();
}

function injectStylesOnce(): void {
  if (document.getElementById("tse-menu-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-menu-styles";
  style.textContent = `
    .${SECTION_CLASS} {
      padding: 4px 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      margin-top: 4px;
    }
    .tse-menu-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 7px 10px;
      border: none;
      border-radius: 8px;
      background: none;
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
      transition: background 0.12s ease;
    }
    .tse-menu-row:hover,
    .tse-menu-row.tse-active {
      background: rgba(255, 255, 255, 0.08);
    }
    .tse-menu-row .tse-chev {
      margin-inline-start: auto;
      opacity: 0.6;
      font-size: 13px;
    }
    .tse-current-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
    }
    .${FLYOUT_CLASS} {
      position: fixed;
      min-width: 190px;
      background: #1f1f21;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.3);
      z-index: 2147483646;
      animation: tseFlyoutFadeIn 0.14s ease-out;
    }
    @keyframes tseFlyoutFadeIn {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }
    .tse-flyout .tse-menu-row.tse-checked {
      background: rgba(255, 255, 255, 0.08);
      font-weight: 500;
    }
    .tse-flyout .tse-check {
      margin-inline-start: auto;
      opacity: 0.9;
      font-weight: 700;
      font-size: 13px;
    }
    .tse-flyout-sep {
      height: 1px;
      background: rgba(255, 255, 255, 0.08);
      margin: 5px 8px;
    }
    .tse-color-grid {
      display: grid !important;
      grid-template-columns: repeat(5, 28px) !important;
      gap: 6px !important;
      padding: 6px 4px !important;
      justify-content: center !important;
      box-sizing: border-box !important;
    }
    .tse-color-swatch {
      width: 28px !important;
      height: 28px !important;
      border-radius: 7px !important;
      border: 1px solid rgba(255, 255, 255, 0.18) !important;
      cursor: pointer !important;
      padding: 0 !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
      transition: transform 0.1s ease, box-shadow 0.1s ease !important;
    }
    .tse-color-swatch:hover {
      transform: scale(1.15) !important;
      box-shadow: 0 0 8px rgba(255, 255, 255, 0.45) !important;
      z-index: 2 !important;
    }
    .tse-color-custom-row {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      padding: 7px 8px !important;
      border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
      font-size: 12.5px !important;
      color: #e4e4e7 !important;
      cursor: pointer !important;
    }
    .tse-color-input {
      width: 24px !important;
      height: 24px !important;
      border: 1px solid rgba(255, 255, 255, 0.22) !important;
      border-radius: 5px !important;
      background: none !important;
      cursor: pointer !important;
      padding: 0 !important;
    }
    }
  `;
  document.head.appendChild(style);
}

function currentProjectId(goalId: string | null): string | null {
  if (!goalId) return null;
  return getViewState().assignments[goalId]?.projectId ?? null;
}

function currentColorOverride(goalId: string | null): string | null {
  if (!goalId) return null;
  return getViewState().assignments[goalId]?.overrideColor ?? null;
}

function projectColorById(projectId: string | null): string | undefined {
  if (!projectId) return undefined;
  return getProjects().find((p) => p.id === projectId)?.color;
}

function closeNativeMenu(): void {
  closeFlyouts();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

async function assign(goalId: string, projectId: string | null, projectName: string | undefined): Promise<void> {
  const prevProjectId = currentProjectId(goalId);

  pushAction({
    id: crypto.randomUUID(),
    description: projectName ? `Assign to ${projectName}` : "Remove project",
    undo: async () => {
      optimisticAssign(goalId, prevProjectId);
      await sendToBg({ type: "ASSIGN_PROJECTS", goalIds: [goalId], projectId: prevProjectId });
    },
    redo: async () => {
      optimisticAssign(goalId, projectId);
      await sendToBg({ type: "ASSIGN_PROJECTS", goalIds: [goalId], projectId });
    },
  });

  // 1. Optimistic instant in-memory update -> DOM updates immediately (0ms latency)
  optimisticAssign(goalId, projectId);
  closeNativeMenu();

  if (projectName) {
    showToast(`Assigned to ${projectName}`, projectColorById(projectId));
  } else {
    showToast("Project removed");
  }

  // 2. Persist in background via service worker
  const res = await sendToBg({ type: "ASSIGN_PROJECTS", goalIds: [goalId], projectId });
  if (res && !res.ok) {
    showToast(`Assignment failed: ${res.error}`);
  }
}

async function setColor(goalId: string, color: string | null): Promise<void> {
  const prevColor = currentColorOverride(goalId);

  pushAction({
    id: crypto.randomUUID(),
    description: color ? "Set color override" : "Reset to project color",
    undo: async () => {
      optimisticColorOverride(goalId, prevColor);
      await sendToBg({ type: "SET_COLOR_OVERRIDE", goalIds: [goalId], color: prevColor });
    },
    redo: async () => {
      optimisticColorOverride(goalId, color);
      await sendToBg({ type: "SET_COLOR_OVERRIDE", goalIds: [goalId], color });
    },
  });

  optimisticColorOverride(goalId, color);
  closeNativeMenu();

  if (color) {
    showToast("Color override set", color);
  } else {
    showToast("Reset to project color");
  }

  const res = await sendToBg({ type: "SET_COLOR_OVERRIDE", goalIds: [goalId], color });
  if (res && !res.ok) {
    showToast(`Color update failed: ${res.error}`);
  }
}

function openColorFlyout(goalId: string, anchorRow: HTMLElement, parentMenu: Element): void {
  closeFlyouts();
  activeParentMenu = parentMenu;
  anchorRow.classList.add("tse-active");

  const flyout = document.createElement("div");
  flyout.className = FLYOUT_CLASS;
  activeFlyout = flyout;

  flyout.addEventListener("mouseenter", () => cancelCloseTimer());
  flyout.addEventListener("mouseleave", () => scheduleCloseFlyout(180));

  const grid = document.createElement("div");
  grid.className = "tse-color-grid";

  for (const c of QUICK_COLOR_SWATCHES) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "tse-color-swatch";
    swatch.style.background = c;
    swatch.title = c;
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      void setColor(goalId, c);
    });
    grid.appendChild(swatch);
  }
  flyout.appendChild(grid);

  const customRow = document.createElement("div");
  customRow.className = "tse-color-custom-row";
  const customInput = document.createElement("input");
  customInput.type = "color";
  customInput.className = "tse-color-input";
  customInput.value = currentColorOverride(goalId) ?? "#7c5cff";
  customInput.addEventListener("change", (e) => {
    e.stopPropagation();
    void setColor(goalId, (e.target as HTMLInputElement).value);
  });
  const customLabel = document.createElement("span");
  customLabel.textContent = "Custom color";
  customRow.append(customInput, customLabel);
  flyout.appendChild(customRow);

  const override = currentColorOverride(goalId);
  if (override) {
    const sep = document.createElement("div");
    sep.className = "tse-flyout-sep";
    flyout.appendChild(sep);

    const resetRow = document.createElement("button");
    resetRow.type = "button";
    resetRow.className = "tse-menu-row";
    resetRow.textContent = "Reset to project color";
    resetRow.addEventListener("click", (e) => {
      e.stopPropagation();
      void setColor(goalId, null);
    });
    flyout.appendChild(resetRow);
  }

  document.body.appendChild(flyout);

  const rect = anchorRow.getBoundingClientRect();
  const fw = flyout.offsetWidth;
  const fh = flyout.offsetHeight;
  let left = rect.left - fw - 6;
  if (left < 8) left = rect.right + 6;
  if (left + fw > window.innerWidth - 8) left = window.innerWidth - fw - 8;
  let top = rect.top - 4;
  if (top + fh > window.innerHeight - 8) top = window.innerHeight - fh - 8;
  flyout.style.left = `${Math.max(8, left)}px`;
  flyout.style.top = `${Math.max(8, top)}px`;
}

async function setTextConfig(
  goalId: string,
  patch: Partial<TaskTextConfig> | null,
  labelText: string,
): Promise<void> {
  const prevConfig = getTaskTextConfigs()[goalId] ?? {};

  pushAction({
    id: crypto.randomUUID(),
    description: labelText,
    undo: async () => {
      optimisticTextConfig(goalId, prevConfig);
      await sendToBg({ type: "SET_TASK_TEXT_CONFIG", goalIds: [goalId], patch: prevConfig });
    },
    redo: async () => {
      optimisticTextConfig(goalId, patch);
      await sendToBg({ type: "SET_TASK_TEXT_CONFIG", goalIds: [goalId], patch });
    },
  });

  optimisticTextConfig(goalId, patch);
  closeNativeMenu();
  showToast(labelText);

  const res = await sendToBg({ type: "SET_TASK_TEXT_CONFIG", goalIds: [goalId], patch });
  if (res && !res.ok) {
    showToast(`Failed: ${res.error}`);
  }
}

function openTextDirectionFlyout(goalId: string, anchorRow: HTMLElement, parentMenu: Element): void {
  closeFlyouts();
  activeParentMenu = parentMenu;
  anchorRow.classList.add("tse-active");

  const flyout = document.createElement("div");
  flyout.className = FLYOUT_CLASS;
  activeFlyout = flyout;

  flyout.addEventListener("mouseenter", () => cancelCloseTimer());
  flyout.addEventListener("mouseleave", () => scheduleCloseFlyout(180));

  const currentConfig = getTaskTextConfigs()[goalId] ?? {};

  const makeRow = (label: string, isChecked: boolean, onClick: () => void) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = isChecked ? "tse-menu-row tse-checked" : "tse-menu-row";
    const lbl = document.createElement("span");
    lbl.textContent = label;
    row.appendChild(lbl);
    if (isChecked) {
      const chk = document.createElement("span");
      chk.className = "tse-check";
      chk.textContent = "✓";
      row.appendChild(chk);
    }
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return row;
  };

  // Direction options
  flyout.appendChild(
    makeRow("Auto (Default)", !currentConfig.direction || currentConfig.direction === "auto", () => {
      void setTextConfig(goalId, { direction: "auto" }, "Direction: Auto");
    }),
  );
  flyout.appendChild(
    makeRow("Right-to-Left (RTL) ⇄", currentConfig.direction === "rtl", () => {
      void setTextConfig(goalId, { direction: "rtl", alignment: "right" }, "Direction: RTL (Arabic)");
    }),
  );
  flyout.appendChild(
    makeRow("Left-to-Right (LTR) ⇄", currentConfig.direction === "ltr", () => {
      void setTextConfig(goalId, { direction: "ltr", alignment: "left" }, "Direction: LTR (English)");
    }),
  );

  const sep = document.createElement("div");
  sep.className = "tse-flyout-sep";
  flyout.appendChild(sep);

  // Alignment options
  flyout.appendChild(
    makeRow("Align Left ⫷", currentConfig.alignment === "left", () => {
      void setTextConfig(goalId, { alignment: "left" }, "Align: Left");
    }),
  );
  flyout.appendChild(
    makeRow("Align Center ≡", currentConfig.alignment === "center", () => {
      void setTextConfig(goalId, { alignment: "center" }, "Align: Center");
    }),
  );
  flyout.appendChild(
    makeRow("Align Right ⫸", currentConfig.alignment === "right", () => {
      void setTextConfig(goalId, { alignment: "right" }, "Align: Right");
    }),
  );

  document.body.appendChild(flyout);

  const rect = anchorRow.getBoundingClientRect();
  const fw = flyout.offsetWidth;
  const fh = flyout.offsetHeight;
  let left = rect.left - fw - 6;
  if (left < 8) left = rect.right + 6;
  if (left + fw > window.innerWidth - 8) left = window.innerWidth - fw - 8;
  let top = rect.top - 4;
  if (top + fh > window.innerHeight - 8) top = window.innerHeight - fh - 8;
  flyout.style.left = `${Math.max(8, left)}px`;
  flyout.style.top = `${Math.max(8, top)}px`;
}

function openFlyout(goalId: string, anchorRow: HTMLElement, parentMenu: Element): void {
  const projects = getProjects();
  closeFlyouts();
  if (projects.length === 0) {
    showToast("No projects yet — create one in the extension popup");
    return;
  }

  activeParentMenu = parentMenu;
  anchorRow.classList.add("tse-active");

  const current = currentProjectId(goalId);
  const flyout = document.createElement("div");
  flyout.className = FLYOUT_CLASS;
  activeFlyout = flyout;

  // Keep open when mouse enters flyout, schedule close when leaving
  flyout.addEventListener("mouseenter", () => {
    cancelCloseTimer();
  });
  flyout.addEventListener("mouseleave", () => {
    scheduleCloseFlyout(180);
  });

  for (const project of projects) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = project.id === current ? "tse-menu-row tse-checked" : "tse-menu-row";
    const dot = document.createElement("span");
    dot.className = "tse-current-dot";
    dot.style.background = project.color;
    row.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = project.name;
    label.dir = "auto";
    row.appendChild(label);
    if (project.id === current) {
      const check = document.createElement("span");
      check.className = "tse-check";
      check.textContent = "✓";
      row.appendChild(check);
    }
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      void assign(goalId, project.id, project.name);
    });
    flyout.appendChild(row);
  }

  if (current) {
    const sep = document.createElement("div");
    sep.className = "tse-flyout-sep";
    flyout.appendChild(sep);
    const removeRow = document.createElement("button");
    removeRow.type = "button";
    removeRow.className = "tse-menu-row";
    removeRow.textContent = "Remove project";
    removeRow.addEventListener("click", (e) => {
      e.stopPropagation();
      void assign(goalId, null, undefined);
    });
    flyout.appendChild(removeRow);
  }

  document.body.appendChild(flyout);

  // Smart positioning: beside the anchor row, flip if close to edge
  const rect = anchorRow.getBoundingClientRect();
  const fw = flyout.offsetWidth;
  const fh = flyout.offsetHeight;
  let left = rect.left - fw - 6;
  if (left < 8) left = rect.right + 6;
  if (left + fw > window.innerWidth - 8) left = window.innerWidth - fw - 8;
  let top = rect.top - 4;
  if (top + fh > window.innerHeight - 8) top = window.innerHeight - fh - 8;
  flyout.style.left = `${Math.max(8, left)}px`;
  flyout.style.top = `${Math.max(8, top)}px`;
}

/** Inject our section into a freshly opened native goal menu. */
function maybeInject(menu: Element): void {
  if (processedMenus.has(menu)) return;
  const text = menu.textContent ?? "";
  if (!MENU_SIGNATURE.every((s) => text.includes(s))) return;
  processedMenus.add(menu);
  const goalId = pendingGoalId;
  if (!goalId) return;

  injectStylesOnce();
  const section = document.createElement("div");
  section.className = SECTION_CLASS;

  const row = document.createElement("button");
  row.type = "button";
  row.className = "tse-menu-row";
  const currentId = currentProjectId(goalId);
  const dot = document.createElement("span");
  dot.className = "tse-current-dot";
  dot.style.background = currentId ? (projectColorById(currentId) ?? "#8a8a8a") : "#8a8a8a";
  row.appendChild(dot);
  const label = document.createElement("span");
  label.textContent = "Project";
  row.appendChild(label);
  const chev = document.createElement("span");
  chev.className = "tse-chev";
  chev.textContent = "›";
  row.appendChild(chev);

  // Hover lifecycle on the trigger row:
  row.addEventListener("mouseenter", () => {
    cancelCloseTimer();
    openFlyout(goalId, row, menu);
  });
  row.addEventListener("mouseleave", () => {
    row.classList.remove("tse-active");
    scheduleCloseFlyout(180);
  });
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelCloseTimer();
    openFlyout(goalId, row, menu);
  });

  // When hovering ANY OTHER item in the parent menu, immediately dismiss the flyout
  menu.addEventListener(
    "mouseover",
    (e) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest(`.${SECTION_CLASS}`)) return;
      closeFlyouts();
    },
    true,
  );

  section.appendChild(row);

  // Color Override Row (PRD §8.3)
  const colorRow = document.createElement("button");
  colorRow.type = "button";
  colorRow.className = "tse-menu-row";
  const overrideColor = currentColorOverride(goalId);
  const colorDot = document.createElement("span");
  colorDot.className = "tse-current-dot";
  colorDot.style.background = overrideColor ?? (currentId ? (projectColorById(currentId) ?? "#8a8a8a") : "#8a8a8a");
  colorRow.appendChild(colorDot);
  const colorLabel = document.createElement("span");
  colorLabel.textContent = overrideColor ? "Color (custom)" : "Color";
  colorRow.appendChild(colorLabel);
  const colorChev = document.createElement("span");
  colorChev.className = "tse-chev";
  colorChev.textContent = "›";
  colorRow.appendChild(colorChev);

  colorRow.addEventListener("mouseenter", () => {
    cancelCloseTimer();
    openColorFlyout(goalId, colorRow, menu);
  });
  colorRow.addEventListener("mouseleave", () => {
    colorRow.classList.remove("tse-active");
    scheduleCloseFlyout(180);
  });
  colorRow.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelCloseTimer();
    openColorFlyout(goalId, colorRow, menu);
  });
  section.appendChild(colorRow);

  // Smart Duplicate Row (PRD §19)
  const dupRow = document.createElement("button");
  dupRow.type = "button";
  dupRow.className = "tse-menu-row";
  const dupLabel = document.createElement("span");
  dupLabel.textContent = "Duplicate with options…";
  dupRow.appendChild(dupLabel);
  dupRow.addEventListener("click", (e) => {
    e.stopPropagation();
    closeNativeMenu();
    void openDuplicateModal(goalId);
  });
  section.appendChild(dupRow);

  // Goal Templates Row (PRD §27–§30)
  const tplRow = document.createElement("button");
  tplRow.type = "button";
  tplRow.className = "tse-menu-row";
  const tplLabel = document.createElement("span");
  tplLabel.textContent = "Templates…";
  tplRow.appendChild(tplLabel);
  tplRow.addEventListener("click", (e) => {
    e.stopPropagation();
    closeNativeMenu();
    void openTemplatesModal("apply");
  });
  section.appendChild(tplRow);

  // Per-task Text Direction & Alignment (PRD §36.1)
  const dirRow = document.createElement("button");
  dirRow.type = "button";
  dirRow.className = "tse-menu-row";
  const dirLabel = document.createElement("span");
  const currentConfig = getTaskTextConfigs()[goalId];
  dirLabel.textContent =
    currentConfig?.direction === "rtl"
      ? "Text: RTL (Arabic)"
      : currentConfig?.direction === "ltr"
        ? "Text: LTR (English)"
        : "Text Direction";
  dirRow.appendChild(dirLabel);
  const dirChev = document.createElement("span");
  dirChev.className = "tse-chev";
  dirChev.textContent = "›";
  dirRow.appendChild(dirChev);

  dirRow.addEventListener("mouseenter", () => {
    cancelCloseTimer();
    openTextDirectionFlyout(goalId, dirRow, menu);
  });
  dirRow.addEventListener("mouseleave", () => {
    dirRow.classList.remove("tse-active");
    scheduleCloseFlyout(180);
  });
  dirRow.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelCloseTimer();
    openTextDirectionFlyout(goalId, dirRow, menu);
  });
  section.appendChild(dirRow);

  // Insert before the native "Delete" row when we can find it, otherwise append
  const deleteEl = Array.from(menu.querySelectorAll<HTMLElement>("button, [role='menuitem']")).find(
    (el) => (el.textContent ?? "").trim() === "Delete",
  );
  const deleteContainer = deleteEl ? deleteEl.closest("div") : null;
  if (deleteContainer?.parentElement) {
    deleteContainer.parentElement.insertBefore(section, deleteContainer);
  } else {
    menu.appendChild(section);
  }
}

/** Called by the main observer loop on every DOM churn. */
export function scanForNativeMenus(): void {
  // If the parent menu was closed/removed by Timestripe, purge any lingering flyout
  if (activeParentMenu && !document.contains(activeParentMenu)) {
    closeFlyouts();
  }
  for (const menu of document.querySelectorAll("[role='menu']")) {
    maybeInject(menu);
  }
}
