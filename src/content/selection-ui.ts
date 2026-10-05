/**
 * Selection UI & Manager (PRD §11–§18).
 * Injects independent circular selection checkboxes inside goal row content horizontally (PRD §11.2),
 * handles partial parent confirmation dialog (PRD §13.4), supports Shift+Click selection,
 * and maintains a rock-solid, persistent floating Selection Manager bar without jitter or flicker.
 */

import { scanGoalRows } from "./adapter";
import { openDuplicateModal } from "./duplicate-modal";
import { openSchedulerModal } from "./scheduler-modal";
import { openTemplatesModal } from "./templates-modal";
import { sendToBg } from "./messaging";
import {
  clearAllSelection,
  clearSubtree,
  getDescendants,
  getSelectedCount,
  getSelectedIds,
  getSelectedRoots,
  getTreeSelectionState,
  selectEntireSubtree,
  selectRangeTo,
  subscribeSelection,
  toggleGoalWithTree,
  toggleSingleGoal,
} from "./selection-state";
import {
  getProjects,
  getTaskColorOverrides,
  getTaskTextConfigs,
  getViewState,
  optimisticAssign,
  optimisticColorOverride,
  optimisticTextConfig,
} from "./state";
import { pushAction } from "./history";
import { showToast } from "./toast";
import type { BulkDeleteResult } from "../shared/messages";
import type { TaskTextConfig } from "../shared/types";

const CHECKBOX_CLASS = "tse-select-btn";
const BAR_ID = "tse-selection-bar";
const PARTIAL_POPUP_CLASS = "tse-partial-popup";

const QUICK_COLORS = [
  "#FFFFFF", "#D6D6D6", "#8A8A8A", "#262626", "#18181B",
  "#F000F0", "#9013FE", "#2D2DE8", "#00A8FF", "#00E676",
  "#AEEA00", "#FFEA00", "#FF9100", "#FF3D00", "#C62828",
  "#F48FB1", "#CE93D8", "#90CAF9", "#80CBC4", "#FFE082",
];

let activePartialPopup: HTMLElement | null = null;
let activeBarFlyout: HTMLElement | null = null;

// Persistent bar element references to avoid DOM churn & hover jitter
interface BarHandle {
  barEl: HTMLElement;
  badgeEl: HTMLElement;
  parentLabelEl: HTMLElement;
}
let currentBarHandle: BarHandle | null = null;
let activeBarFlyoutType: "project" | "color" | "direction" | null = null;

function closePartialPopup(): void {
  if (activePartialPopup) {
    activePartialPopup.remove();
    activePartialPopup = null;
  }
}

function closeBarFlyout(): void {
  if (activeBarFlyout) {
    activeBarFlyout.remove();
    activeBarFlyout = null;
  }
  activeBarFlyoutType = null;
}

// Global cleanup for popups
document.addEventListener("pointerdown", (e) => {
  const target = e.target as Element | null;
  if (activePartialPopup && !target?.closest(`.${PARTIAL_POPUP_CLASS}`)) {
    closePartialPopup();
  }
  if (activeBarFlyout && !target?.closest(".tse-bar-flyout") && !target?.closest(".tse-bar-btn")) {
    closeBarFlyout();
  }
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePartialPopup();
    closeBarFlyout();
    if (getSelectedCount() > 0) {
      clearAllSelection();
    }
  }
});

function injectSelectionStyles(): void {
  if (document.getElementById("tse-selection-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-selection-styles";
  style.textContent = `
    /* Independent circular selection checkbox on goal row (PRD §11.2) */
    .${CHECKBOX_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 0;
      height: 18px;
      margin: 0;
      padding: 0;
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
      border-radius: 50%;
      border: 1.5px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.05);
      cursor: pointer;
      flex-shrink: 0;
      transition: width 0.14s ease, margin 0.14s ease, opacity 0.14s ease, background 0.1s ease;
      user-select: none;
      z-index: 5;
    }
    /* Show smoothly when row is hovered OR when Selection Mode is active */
    .GoalRow:hover .${CHECKBOX_CLASS},
    body[data-tse-selecting="true"] .${CHECKBOX_CLASS},
    .${CHECKBOX_CLASS}[data-tse-state="checked"],
    .${CHECKBOX_CLASS}[data-tse-state="partial"] {
      width: 18px;
      margin-inline-end: 7px;
      opacity: 0.65;
      pointer-events: auto;
    }
    .GoalRow:hover .${CHECKBOX_CLASS}:hover,
    .${CHECKBOX_CLASS}[data-tse-state="checked"],
    .${CHECKBOX_CLASS}[data-tse-state="partial"] {
      opacity: 1;
    }
    .${CHECKBOX_CLASS}:hover {
      border-color: rgba(255, 255, 255, 0.55);
      background: rgba(255, 255, 255, 0.12);
      transform: scale(1.06);
    }
    .${CHECKBOX_CLASS}[data-tse-state="checked"] {
      background: #7c5cff !important;
      border-color: #7c5cff !important;
      box-shadow: 0 0 8px rgba(124, 92, 255, 0.45);
    }
    .${CHECKBOX_CLASS}[data-tse-state="partial"] {
      background: #7c5cff !important;
      border-color: #7c5cff !important;
      box-shadow: 0 0 8px rgba(124, 92, 255, 0.45);
    }
    .${CHECKBOX_CLASS} svg {
      width: 10.5px;
      height: 10.5px;
      stroke: #ffffff;
      stroke-width: 2.6;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .${CHECKBOX_CLASS}[data-tse-state="unchecked"] svg {
      stroke: rgba(255, 255, 255, 0.45);
    }

    /* Partial Selection Confirmation Popup (PRD §13.4) */
    .${PARTIAL_POPUP_CLASS} {
      position: fixed;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
      color: #f4f4f5;
      font-size: 12.5px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 2147483647;
      animation: tseFadeIn 0.12s ease-out;
      min-width: 180px;
    }
    .${PARTIAL_POPUP_CLASS} .tse-popup-title {
      font-weight: 500;
      color: #e4e4e7;
    }
    .${PARTIAL_POPUP_CLASS} .tse-popup-btn {
      padding: 5px 9px;
      border-radius: 6px;
      border: none;
      background: rgba(255, 255, 255, 0.08);
      color: #f4f4f5;
      font-size: 12px;
      cursor: pointer;
      text-align: start;
      transition: background 0.1s ease;
    }
    .${PARTIAL_POPUP_CLASS} .tse-popup-btn:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    .${PARTIAL_POPUP_CLASS} .tse-popup-btn.primary {
      background: #7c5cff;
      font-weight: 500;
    }
    .${PARTIAL_POPUP_CLASS} .tse-popup-btn.primary:hover {
      background: #6a46f7;
    }

    /* Floating Selection Manager Bar (PRD §12) - Rock solid, no vibration */
    #${BAR_ID} {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(24, 24, 27, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(0, 0, 0, 0.3);
      border-radius: 12px;
      padding: 7px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 2147483645;
      color: #f4f4f5;
      font-size: 13px;
      user-select: none;
    }
    .tse-bar-count {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      padding-inline-end: 8px;
      border-inline-end: 1px solid rgba(255, 255, 255, 0.12);
    }
    .tse-bar-badge {
      background: #7c5cff;
      color: #ffffff;
      padding: 1.5px 7px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
    }
    .tse-bar-subcount {
      font-size: 11.5px;
      color: #a1a1aa;
      font-weight: 400;
    }
    .tse-bar-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tse-bar-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 10px;
      border-radius: 7px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.05);
      color: #f4f4f5;
      font-size: 12.5px;
      cursor: pointer;
      outline: none;
      transition: background 0.1s ease, border-color 0.1s ease;
    }
    .tse-bar-btn:hover {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.22);
    }
    .tse-bar-btn.danger {
      color: #f87171;
    }
    .tse-bar-btn.danger:hover {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.35);
    }
    .tse-bar-btn.close {
      padding: 5px 7px;
      color: #a1a1aa;
    }
    .tse-bar-btn.close:hover {
      color: #ffffff;
    }

    /* Flyout for Bar Buttons */
    .tse-bar-flyout {
      position: fixed;
      background: #1f1f21;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65);
      z-index: 2147483646;
      min-width: 196px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      animation: tseFadeIn 0.12s ease-out;
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
    .tse-flyout-sep {
      height: 1px !important;
      background: rgba(255, 255, 255, 0.08) !important;
      margin: 4px 6px !important;
    }
    .tse-menu-row {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      width: 100% !important;
      padding: 7px 10px !important;
      border: none !important;
      border-radius: 8px !important;
      background: none !important;
      color: inherit !important;
      font: inherit !important;
      text-align: start !important;
      cursor: pointer !important;
      transition: background 0.12s ease !important;
      font-size: 12.5px !important;
    }
    .tse-menu-row:hover {
      background: rgba(255, 255, 255, 0.09) !important;
    }
    .tse-current-dot {
      width: 10px !important;
      height: 10px !important;
      border-radius: 50% !important;
      flex-shrink: 0 !important;
    }
  `;
  document.head.appendChild(style);
}

function showPartialPopup(goalId: string, anchorEl: HTMLElement, total: number, selected: number): void {
  closePartialPopup();
  const popup = document.createElement("div");
  popup.className = PARTIAL_POPUP_CLASS;
  activePartialPopup = popup;

  const title = document.createElement("div");
  title.className = "tse-popup-title";
  title.textContent = `${selected} of ${total} selected in group`;

  const selectAllBtn = document.createElement("button");
  selectAllBtn.type = "button";
  selectAllBtn.className = "tse-popup-btn primary";
  selectAllBtn.textContent = `Select all ${total}`;
  selectAllBtn.onclick = () => {
    selectEntireSubtree(goalId);
    closePartialPopup();
  };

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "tse-popup-btn";
  clearBtn.textContent = "Clear this group";
  clearBtn.onclick = () => {
    clearSubtree(goalId);
    closePartialPopup();
  };

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "tse-popup-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = closePartialPopup;

  popup.append(title, selectAllBtn, clearBtn, cancelBtn);
  document.body.appendChild(popup);

  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${Math.max(8, rect.left)}px`;
  popup.style.top = `${Math.max(8, rect.top - popup.offsetHeight - 6)}px`;
}

function updateCheckboxEl(btn: HTMLElement, goalId: string): void {
  const info = getTreeSelectionState(goalId);
  btn.dataset.tseState = info.state;

  if (info.state === "checked") {
    btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    btn.title = "Selected (click to unselect)";
  } else if (info.state === "partial") {
    btn.innerHTML = `<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    btn.title = `${info.selectedDescendants} of ${info.totalDescendants} selected (click for options)`;
  } else {
    // Subtle hint checkmark when hovered
    btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    btn.title = "Select task (or Shift+Click row)";
  }
}

/** Render or update selection checkboxes across all visible goal rows. */
export function reconcileCheckboxes(): void {
  injectSelectionStyles();
  const selectedCount = getSelectedCount();
  document.body.dataset.tseSelecting = selectedCount > 0 ? "true" : "false";

  const rows = scanGoalRows();
  for (const { goalId, row } of rows.values()) {
    // Target the content flex-line so it sits horizontally side-by-side with the native checkbox
    const targetParent = row.querySelector<HTMLElement>(":scope > .GoalRow-content") ?? row;

    let btn = targetParent.querySelector<HTMLButtonElement>(`:scope > .${CHECKBOX_CLASS}`);
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = CHECKBOX_CLASS;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.shiftKey) {
          selectRangeTo(goalId);
        } else {
          const info = getTreeSelectionState(goalId);
          if (info.state === "partial") {
            showPartialPopup(goalId, btn!, info.totalDescendants, info.selectedDescendants);
          } else if (info.totalDescendants > 0) {
            toggleGoalWithTree(goalId);
          } else {
            toggleSingleGoal(goalId);
          }
        }
      });

      // Insert at the very front of the horizontal content line
      targetParent.prepend(btn);

      // Support Shift + Click anywhere on the task row
      row.addEventListener("click", (e) => {
        if (document.querySelector(".tse-dash-overlay, .tse-modal-backdrop")) return;
        if (e.shiftKey) {
          const t = e.target as HTMLElement | null;
          if (t?.closest("a, button, input, [role='checkbox'], [role='menu']")) return;
          e.preventDefault();
          e.stopPropagation();
          selectRangeTo(goalId);
        }
      });

      // Middle-click (wheel click) anywhere on task row toggles selection
      row.addEventListener("mousedown", (e) => {
        if (e.button === 1) {
          e.preventDefault();
        }
      });
      row.addEventListener("auxclick", (e) => {
        if (document.querySelector(".tse-dash-overlay, .tse-modal-backdrop")) return;
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            selectRangeTo(goalId);
          } else {
            toggleGoalWithTree(goalId);
          }
        }
      });
    }

    updateCheckboxEl(btn, goalId);
  }
}

/** Build or update the floating Selection Manager bar at the bottom cleanly (no DOM rebuild jitter). */
export function reconcileSelectionBar(): void {
  const count = getSelectedCount();

  if (count === 0) {
    if (currentBarHandle) {
      currentBarHandle.barEl.remove();
      currentBarHandle = null;
    }
    closeBarFlyout();
    return;
  }

  const roots = getSelectedRoots();
  const parentCount = roots.filter((id) => getDescendants(id).length > 0).length;

  // If bar already exists, simply update its labels without tearing down DOM or listeners!
  if (currentBarHandle && document.contains(currentBarHandle.barEl)) {
    currentBarHandle.badgeEl.textContent = `${count}`;
    if (parentCount > 0) {
      currentBarHandle.parentLabelEl.textContent = `(${parentCount} parent${parentCount > 1 ? "s" : ""})`;
      currentBarHandle.parentLabelEl.style.display = "inline";
    } else {
      currentBarHandle.parentLabelEl.style.display = "none";
    }
    return;
  }

  // Create bar once
  const bar = document.createElement("div");
  bar.id = BAR_ID;

  // Count info
  const countContainer = document.createElement("div");
  countContainer.className = "tse-bar-count";
  const badge = document.createElement("span");
  badge.className = "tse-bar-badge";
  badge.textContent = `${count}`;
  const countLabel = document.createElement("span");
  countLabel.textContent = `selected`;
  const parentLabel = document.createElement("span");
  parentLabel.className = "tse-bar-subcount";
  if (parentCount > 0) {
    parentLabel.textContent = `(${parentCount} parent${parentCount > 1 ? "s" : ""})`;
  } else {
    parentLabel.style.display = "none";
  }
  countContainer.append(badge, countLabel, parentLabel);
  bar.appendChild(countContainer);

  // Actions
  const actions = document.createElement("div");
  actions.className = "tse-bar-actions";

  // Bulk Project Button
  const projBtn = document.createElement("button");
  projBtn.type = "button";
  projBtn.className = "tse-bar-btn";
  projBtn.innerHTML = `<span>Project</span> <span style="opacity:0.6;font-size:11px">›</span>`;
  projBtn.onclick = (e) => {
    e.stopPropagation();
    openBulkProjectFlyout(projBtn);
  };
  actions.appendChild(projBtn);

  // Bulk Color Button
  const colorBtn = document.createElement("button");
  colorBtn.type = "button";
  colorBtn.className = "tse-bar-btn";
  colorBtn.innerHTML = `<span>Color</span> <span style="opacity:0.6;font-size:11px">›</span>`;
  colorBtn.onclick = (e) => {
    e.stopPropagation();
    openBulkColorFlyout(colorBtn);
  };
  actions.appendChild(colorBtn);

  // Text Direction & Alignment (PRD §36.1)
  const textBtn = document.createElement("button");
  textBtn.type = "button";
  textBtn.className = "tse-bar-btn";
  textBtn.innerHTML = `<span>Text</span> <span style="opacity:0.6;font-size:11px">›</span>`;
  textBtn.onclick = (e) => {
    e.stopPropagation();
    openBulkDirectionFlyout(textBtn);
  };
  actions.appendChild(textBtn);

  // Fast Day Scheduler Button (PRD §23–§26)
  const schedBtn = document.createElement("button");
  schedBtn.type = "button";
  schedBtn.className = "tse-bar-btn";
  schedBtn.textContent = "Schedule…";
  schedBtn.onclick = (e) => {
    e.stopPropagation();
    const ids = getSelectedIds();
    if (ids.length > 0) {
      void openSchedulerModal(ids);
    }
  };
    actions.appendChild(schedBtn);

  // Reusable Templates Button (PRD §27–§30)
  const tplBtn = document.createElement("button");
  tplBtn.type = "button";
  tplBtn.className = "tse-bar-btn";
  tplBtn.textContent = "Templates…";
  tplBtn.onclick = (e) => {
    e.stopPropagation();
    void openTemplatesModal("save");
  };
  actions.appendChild(tplBtn);

  // Smart Duplicate Button (PRD §15, §19)
  const dupBtn = document.createElement("button");
  dupBtn.type = "button";
  dupBtn.className = "tse-bar-btn";
  dupBtn.textContent = "Duplicate…";
  dupBtn.onclick = (e) => {
    e.stopPropagation();
    const ids = getSelectedIds();
    if (ids.length > 0) {
      void openDuplicateModal(ids[0]);
    }
  };
  actions.appendChild(dupBtn);

  // Bulk Delete Button (PRD §18)
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "tse-bar-btn danger";
  delBtn.textContent = "Delete";
  delBtn.onclick = (e) => {
    e.stopPropagation();
    openBulkDeleteModal();
  };
  actions.appendChild(delBtn);

  // Clear Selection Button
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "tse-bar-btn close";
  clearBtn.textContent = "✕";
  clearBtn.title = "Clear selection";
  clearBtn.onclick = (e) => {
    e.stopPropagation();
    clearAllSelection();
  };
  actions.appendChild(clearBtn);

  bar.appendChild(actions);
  document.body.appendChild(bar);

  currentBarHandle = {
    barEl: bar,
    badgeEl: badge,
    parentLabelEl: parentLabel,
  };
}

function openBulkProjectFlyout(anchorBtn: HTMLElement): void {
  if (activeBarFlyoutType === "project") {
    closeBarFlyout();
    return;
  }
  closeBarFlyout();
  activeBarFlyoutType = "project";
  const projects = getProjects();
  const flyout = document.createElement("div");
  flyout.className = "tse-bar-flyout";
  activeBarFlyout = flyout;

  const selectedGoalIds = getSelectedIds();
  const assignments = getViewState().assignments;
  const prevProjects: Record<string, string | null> = {};
  for (const id of selectedGoalIds) {
    prevProjects[id] = assignments[id]?.source === "explicit" ? assignments[id].projectId : null;
  }

  for (const project of projects) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tse-menu-row";
    const dot = document.createElement("span");
    dot.className = "tse-current-dot";
    dot.style.background = project.color;
    const label = document.createElement("span");
    label.textContent = project.name;
    label.dir = "auto";
    row.append(dot, label);
    row.onclick = async () => {
      closeBarFlyout();
      for (const id of selectedGoalIds) optimisticAssign(id, project.id);
      showToast(`Assigned ${selectedGoalIds.length} tasks to ${project.name}`, project.color);

      pushAction({
        id: crypto.randomUUID(),
        description: `Assign ${selectedGoalIds.length} tasks to ${project.name}`,
        undo: async () => {
          for (const [id, prevPId] of Object.entries(prevProjects)) {
            optimisticAssign(id, prevPId);
            await sendToBg({ type: "ASSIGN_PROJECTS", goalIds: [id], projectId: prevPId });
          }
        },
        redo: async () => {
          for (const id of selectedGoalIds) optimisticAssign(id, project.id);
          await sendToBg({ type: "ASSIGN_PROJECTS", goalIds: selectedGoalIds, projectId: project.id });
        },
      });

      const res = await sendToBg({ type: "ASSIGN_PROJECTS", goalIds: selectedGoalIds, projectId: project.id });
      if (res && !res.ok) showToast(`Assignment failed: ${res.error}`);
    };
    flyout.appendChild(row);
  }

  const sep = document.createElement("div");
  sep.className = "tse-flyout-sep";
  flyout.appendChild(sep);

  const removeRow = document.createElement("button");
  removeRow.type = "button";
  removeRow.className = "tse-menu-row";
  removeRow.textContent = "Remove project";
  removeRow.onclick = async () => {
    closeBarFlyout();
    for (const id of selectedGoalIds) optimisticAssign(id, null);
    showToast(`Removed project from ${selectedGoalIds.length} tasks`);

    pushAction({
      id: crypto.randomUUID(),
      description: `Remove project from ${selectedGoalIds.length} tasks`,
      undo: async () => {
        for (const [id, prevPId] of Object.entries(prevProjects)) {
          optimisticAssign(id, prevPId);
          await sendToBg({ type: "ASSIGN_PROJECTS", goalIds: [id], projectId: prevPId });
        }
      },
      redo: async () => {
        for (const id of selectedGoalIds) optimisticAssign(id, null);
        await sendToBg({ type: "ASSIGN_PROJECTS", goalIds: selectedGoalIds, projectId: null });
      },
    });

    const res = await sendToBg({ type: "ASSIGN_PROJECTS", goalIds: selectedGoalIds, projectId: null });
    if (res && !res.ok) showToast(`Failed: ${res.error}`);
  };
  flyout.appendChild(removeRow);

  document.body.appendChild(flyout);
  const rect = anchorBtn.getBoundingClientRect();
  flyout.style.left = `${rect.left}px`;
  flyout.style.top = `${rect.top - flyout.offsetHeight - 6}px`;
}

function openBulkColorFlyout(anchorBtn: HTMLElement): void {
  if (activeBarFlyoutType === "color") {
    closeBarFlyout();
    return;
  }
  closeBarFlyout();
  activeBarFlyoutType = "color";
  const flyout = document.createElement("div");
  flyout.className = "tse-bar-flyout";
  activeBarFlyout = flyout;

  const selectedGoalIds = getSelectedIds();
  const overrides = getTaskColorOverrides();
  const prevOverrides: Record<string, string | null> = {};
  for (const id of selectedGoalIds) {
    prevOverrides[id] = overrides[id] ?? null;
  }

  const applyColor = async (color: string | null, labelText: string) => {
    closeBarFlyout();
    for (const id of selectedGoalIds) optimisticColorOverride(id, color);
    if (color) {
      showToast(`Color set for ${selectedGoalIds.length} tasks`, color);
    } else {
      showToast(`Reset color for ${selectedGoalIds.length} tasks`);
    }

    pushAction({
      id: crypto.randomUUID(),
      description: labelText,
      undo: async () => {
        for (const [id, prevC] of Object.entries(prevOverrides)) {
          optimisticColorOverride(id, prevC);
          await sendToBg({ type: "SET_COLOR_OVERRIDE", goalIds: [id], color: prevC });
        }
      },
      redo: async () => {
        for (const id of selectedGoalIds) optimisticColorOverride(id, color);
        await sendToBg({ type: "SET_COLOR_OVERRIDE", goalIds: selectedGoalIds, color });
      },
    });

    const res = await sendToBg({ type: "SET_COLOR_OVERRIDE", goalIds: selectedGoalIds, color });
    if (res && !res.ok) showToast(`Failed: ${res.error}`);
  };

  const grid = document.createElement("div");
  grid.className = "tse-color-grid";

  for (const c of QUICK_COLORS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "tse-color-swatch";
    swatch.style.background = c;
    swatch.title = c;
    swatch.onclick = () => void applyColor(c, `Set color for ${selectedGoalIds.length} tasks`);
    grid.appendChild(swatch);
  }
  flyout.appendChild(grid);

  // Custom Color Input Row
  const customRow = document.createElement("div");
  customRow.className = "tse-color-custom-row";
  const customInput = document.createElement("input");
  customInput.type = "color";
  customInput.className = "tse-color-input";
  customInput.value = "#7c5cff";
  customInput.onchange = (e) => {
    const val = (e.target as HTMLInputElement).value;
    void applyColor(val, `Custom color for ${selectedGoalIds.length} tasks`);
  };
  const customLabel = document.createElement("span");
  customLabel.textContent = "Custom color";
  customRow.append(customInput, customLabel);
  flyout.appendChild(customRow);

  const sep = document.createElement("div");
  sep.className = "tse-flyout-sep";
  flyout.appendChild(sep);

  const resetRow = document.createElement("button");
  resetRow.type = "button";
  resetRow.className = "tse-menu-row";
  resetRow.textContent = "Reset to project colors";
  resetRow.onclick = () => void applyColor(null, `Reset color for ${selectedGoalIds.length} tasks`);
  flyout.appendChild(resetRow);

  document.body.appendChild(flyout);
  const rect = anchorBtn.getBoundingClientRect();
  flyout.style.left = `${rect.left}px`;
  flyout.style.top = `${rect.top - flyout.offsetHeight - 6}px`;
}

function openBulkDirectionFlyout(anchorBtn: HTMLElement): void {
  if (activeBarFlyoutType === "direction") {
    closeBarFlyout();
    return;
  }
  closeBarFlyout();
  activeBarFlyoutType = "direction";

  const flyout = document.createElement("div");
  flyout.className = "tse-bar-flyout";
  activeBarFlyout = flyout;

  const selectedGoalIds = getSelectedIds();
  const textConfigs = getTaskTextConfigs();
  const prevConfigs: Record<string, TaskTextConfig> = {};
  for (const id of selectedGoalIds) {
    prevConfigs[id] = { ...(textConfigs[id] ?? {}) };
  }

  const applyDirection = async (patch: Partial<TaskTextConfig> | null, labelText: string) => {
    closeBarFlyout();
    for (const id of selectedGoalIds) optimisticTextConfig(id, patch);
    showToast(labelText);

    pushAction({
      id: crypto.randomUUID(),
      description: labelText,
      undo: async () => {
        for (const [id, prev] of Object.entries(prevConfigs)) {
          optimisticTextConfig(id, prev);
          await sendToBg({ type: "SET_TASK_TEXT_CONFIG", goalIds: [id], patch: prev });
        }
      },
      redo: async () => {
        for (const id of selectedGoalIds) optimisticTextConfig(id, patch);
        await sendToBg({ type: "SET_TASK_TEXT_CONFIG", goalIds: selectedGoalIds, patch });
      },
    });

    const res = await sendToBg({ type: "SET_TASK_TEXT_CONFIG", goalIds: selectedGoalIds, patch });
    if (res && !res.ok) showToast(`Failed: ${res.error}`);
  };

  const makeRow = (label: string, onClick: () => void) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tse-menu-row";
    row.textContent = label;
    row.onclick = onClick;
    return row;
  };

  flyout.appendChild(makeRow("Auto (Default)", () => void applyDirection({ direction: "auto" }, "Direction: Auto")));
  flyout.appendChild(makeRow("Right-to-Left (RTL) ⇄", () => void applyDirection({ direction: "rtl", alignment: "right" }, "Direction: RTL (Arabic)")));
  flyout.appendChild(makeRow("Left-to-Right (LTR) ⇄", () => void applyDirection({ direction: "ltr", alignment: "left" }, "Direction: LTR (English)")));

  const sep = document.createElement("div");
  sep.className = "tse-flyout-sep";
  flyout.appendChild(sep);

  flyout.appendChild(makeRow("Align Left ⫷", () => void applyDirection({ alignment: "left" }, "Align: Left")));
  flyout.appendChild(makeRow("Align Center ≡", () => void applyDirection({ alignment: "center" }, "Align: Center")));
  flyout.appendChild(makeRow("Align Right ⫸", () => void applyDirection({ alignment: "right" }, "Align: Right")));

  document.body.appendChild(flyout);
  const rect = anchorBtn.getBoundingClientRect();
  flyout.style.left = `${rect.left}px`;
  flyout.style.top = `${rect.top - flyout.offsetHeight - 6}px`;
}

function openBulkDeleteModal(): void {
  const selectedGoalIds = getSelectedIds();
  const totalCount = selectedGoalIds.length;
  const roots = getSelectedRoots();
  const parentsWithChildren = roots.filter((id) => getDescendants(id).length > 0);

  const backdrop = document.createElement("div");
  backdrop.className = "tse-modal-backdrop";

  const box = document.createElement("div");
  box.className = "tse-modal-box";

  const title = document.createElement("div");
  title.className = "tse-modal-title";
  title.innerHTML = `<span>Delete ${totalCount} Goal${totalCount > 1 ? "s" : ""}?</span>`;

  const warning = document.createElement("div");
  warning.style.fontSize = "13.5px";
  warning.style.lineHeight = "1.5";
  warning.style.color = "#d4d4d8";
  warning.innerHTML = `
    You are about to permanently delete <strong>${totalCount} goals</strong> from Timestripe.
    ${parentsWithChildren.length > 0 ? `<br><span style="color:#f87171">⚠️ ${parentsWithChildren.length} of the selected goals contain descendants that will also be removed.</span>` : ""}
  `;

  const actions = document.createElement("div");
  actions.className = "tse-modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "tse-btn tse-btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => backdrop.remove();

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "tse-btn";
  confirmBtn.style.background = "#ef4444";
  confirmBtn.style.color = "#ffffff";
  confirmBtn.textContent = `Delete ${totalCount} Goals`;

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Deleting…";

    try {
      const res = await sendToBg<BulkDeleteResult>({
        type: "BULK_DELETE_GOALS",
        goalIds: selectedGoalIds,
      });

      if (res?.ok) {
        showToast(`Deleted ${res.data.completed} goals${res.data.failed > 0 ? ` (${res.data.failed} failed)` : ""}`);
        clearAllSelection();
        backdrop.remove();
      } else {
        showToast(`Delete failed: ${res?.error ?? "Unknown error"}`);
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Delete";
      }
    } catch (e) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`);
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Delete";
    }
  };

  actions.append(cancelBtn, confirmBtn);
  box.append(title, warning, actions);
  backdrop.appendChild(box);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };

  document.body.appendChild(backdrop);
}

/** Initialize selection UI subscription and observation. */
export function initSelectionUI(): () => void {
  const unsub = subscribeSelection(() => {
    reconcileCheckboxes();
    reconcileSelectionBar();
  });

  return unsub;
}
