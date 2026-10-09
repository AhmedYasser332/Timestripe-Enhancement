/**
 * Auto-complete parent goals when all subgoals are completed.
 * Features:
 * - Deterministic intent capture: determines check vs uncheck at the instant of click in the capturing phase.
 * - Multi-tier cascade completion (Day -> Week -> Month -> Quarter -> Year -> Decade -> Life) in DOM & API.
 * - Full reverse cascade uncheck: unchecking any child automatically unchecks all ancestors up the tree.
 * - Sleek confirmation popover when unchecking a parent goal that has completed subgoals.
 */

import {
  getNativeGoalCheckbox,
  goalIdFromWrapper,
  isGoalChecked,
  scanGoalRows,
} from "./adapter";
import { getGoalParents, getSettings } from "./state";
import { sendToBg } from "./messaging";
import { showToast } from "./toast";
import type {
  AutoCompleteParentResult,
  CheckSubgoalsStatusResult,
  UncheckAllDescendantsResult,
} from "../shared/messages";

let isProgrammaticClick = false;
let activeUncheckPopover: HTMLElement | null = null;

function triggerNativeCheckboxClick(cb: HTMLElement): void {
  isProgrammaticClick = true;
  try {
    cb.click();
  } catch {
    cb.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
    );
  }
  setTimeout(() => {
    isProgrammaticClick = false;
  }, 400);
}

function closeUncheckPopover(): void {
  if (activeUncheckPopover) {
    activeUncheckPopover.remove();
    activeUncheckPopover = null;
  }
}

function injectAutoCompleteStyles(): void {
  if (document.getElementById("tse-autocomplete-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-autocomplete-styles";
  style.textContent = `
    .tse-uncheck-popover {
      position: fixed;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 12px;
      padding: 13px 15px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.08);
      color: #f4f4f5;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 2147483647;
      min-width: 250px;
      max-width: 320px;
      animation: tseFadeIn 0.14s ease-out;
      user-select: none;
    }
    .tse-uncheck-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .tse-uncheck-title {
      font-weight: 600;
      font-size: 13.5px;
      color: #fafafa;
    }
    .tse-uncheck-close {
      background: none;
      border: none;
      color: #71717a;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      padding: 2px 5px;
      border-radius: 4px;
    }
    .tse-uncheck-close:hover {
      color: #f4f4f5;
      background: rgba(255, 255, 255, 0.1);
    }
    .tse-uncheck-desc {
      font-size: 11.5px;
      color: #a1a1aa;
      line-height: 1.4;
      margin: 0;
    }
    .tse-uncheck-actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 2px;
    }
    .tse-uncheck-btn {
      padding: 8px 12px;
      border-radius: 8px;
      border: none;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.12s ease, transform 0.08s ease;
      text-align: center;
    }
    .tse-uncheck-btn:active {
      transform: scale(0.98);
    }
    .tse-uncheck-btn.primary {
      background: #7c5cff;
      color: #ffffff;
      font-weight: 600;
    }
    .tse-uncheck-btn.primary:hover {
      background: #6a46f7;
    }
    .tse-uncheck-btn.secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #f4f4f5;
      font-weight: 500;
    }
    .tse-uncheck-btn.secondary:hover {
      background: rgba(255, 255, 255, 0.14);
    }
  `;
  document.head.appendChild(style);
}

/** Show uncheck options popover when user unchecks a parent goal that has completed subgoals. */
function showUncheckParentPopover(
  goalId: string,
  cb: HTMLElement,
  checkedKidsInDom: string[],
): void {
  closeUncheckPopover();
  injectAutoCompleteStyles();

  const popover = document.createElement("div");
  popover.className = "tse-uncheck-popover";

  const header = document.createElement("div");
  header.className = "tse-uncheck-header";
  const title = document.createElement("span");
  title.className = "tse-uncheck-title";
  title.textContent = "Uncheck goal";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tse-uncheck-close";
  closeBtn.textContent = "✕";
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeUncheckPopover();
  };
  header.append(title, closeBtn);

  const desc = document.createElement("p");
  desc.className = "tse-uncheck-desc";
  desc.textContent = "This goal has completed subgoals. Do you want to uncheck all subgoals as well?";

  const actions = document.createElement("div");
  actions.className = "tse-uncheck-actions";

  const uncheckAllBtn = document.createElement("button");
  uncheckAllBtn.type = "button";
  uncheckAllBtn.className = "tse-uncheck-btn primary";
  uncheckAllBtn.textContent = "Uncheck all subgoals";
  uncheckAllBtn.onclick = (e) => {
    e.stopPropagation();
    closeUncheckPopover();

    // 1. Uncheck parent in DOM
    triggerNativeCheckboxClick(cb);

    // 2. Uncheck all visible checked subgoals in DOM
    const currentRows = scanGoalRows();
    for (const kidId of checkedKidsInDom) {
      const kHandle = currentRows.get(kidId);
      if (kHandle && isGoalChecked(kHandle.wrapper)) {
        const kCb = getNativeGoalCheckbox(kHandle.wrapper);
        if (kCb) triggerNativeCheckboxClick(kCb);
      }
    }

    // 3. Reverse cascade uncheck any higher ancestors in DOM
    uncheckDomCascade(goalId);

    // 4. Background service worker unchecks all descendants recursively on Timestripe API
    void sendToBg<UncheckAllDescendantsResult>({
      type: "UNCHECK_ALL_DESCENDANTS",
      goalId,
    }).then((res) => {
      if (res?.ok && res.data?.uncheckedIds) {
        for (const uId of res.data.uncheckedIds) {
          const uWrapper = document.querySelector<HTMLElement>(
            `.GoalRowWrapper[data-draggable-id*='::goal:${uId}']`,
          );
          if (uWrapper && isGoalChecked(uWrapper)) {
            const uCb = getNativeGoalCheckbox(uWrapper);
            if (uCb) triggerNativeCheckboxClick(uCb);
          }
        }
      }
    });

    showToast("✓ Unchecked goal and all subgoals");
  };

  const onlyParentBtn = document.createElement("button");
  onlyParentBtn.type = "button";
  onlyParentBtn.className = "tse-uncheck-btn secondary";
  onlyParentBtn.textContent = "Only this goal";
  onlyParentBtn.onclick = (e) => {
    e.stopPropagation();
    closeUncheckPopover();

    // 1. Uncheck parent in DOM
    triggerNativeCheckboxClick(cb);

    // 2. Reverse cascade uncheck any higher ancestors in DOM (since parent is no longer complete)
    uncheckDomCascade(goalId);

    // 3. Background service worker unchecks parent and higher ancestors, leaving subgoals intact
    void sendToBg<AutoCompleteParentResult>({
      type: "AUTO_COMPLETE_PARENT",
      goalId,
      checked: false,
    });

    showToast("✓ Unchecked parent goal");
  };

  actions.append(uncheckAllBtn, onlyParentBtn);
  popover.append(header, desc, actions);
  document.body.appendChild(popover);
  activeUncheckPopover = popover;

  // Position popover safely near checkbox
  const rect = cb.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  let top = rect.bottom + 8;
  let left = Math.max(10, rect.left - 20);
  if (top + popRect.height > window.innerHeight - 10) {
    top = Math.max(10, rect.top - popRect.height - 8);
  }
  if (left + popRect.width > window.innerWidth - 10) {
    left = Math.max(10, window.innerWidth - popRect.width - 10);
  }
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;

  // Dismiss on outside click or Escape
  const onDocClick = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node)) {
      closeUncheckPopover();
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeUncheckPopover();
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKeyDown, true);
  }, 50);
}

/** Parse explicit subgoal count from parent text in DOM (e.g. "1 subgoal", "4 subgoals"). */
function parseSubgoalCountFromDom(parentWrapper: HTMLElement): number | null {
  const text = parentWrapper.textContent ?? "";
  const m = text.match(/(\d+)\s*subgoal/i);
  if (m) {
    const count = parseInt(m[1], 10);
    if (!isNaN(count)) return count;
  }
  return null;
}

/** Check DOM ancestors recursively (Day -> Week -> Month -> Quarter -> Year -> Decade -> Life). */
function checkDomCascade(goalId: string): void {
  const rows = scanGoalRows();
  let currGoalId = goalId;

  while (currGoalId) {
    const childHandle = rows.get(currGoalId);
    const parentId = childHandle?.domParentId || getGoalParents()[currGoalId];
    if (!parentId) break;

    const parentHandle = rows.get(parentId);
    if (!parentHandle) break;

    // If parent is already checked, continue checking grandparents!
    if (isGoalChecked(parentHandle.wrapper)) {
      currGoalId = parentId;
      continue;
    }

    const childRows = Array.from(rows.values()).filter(
      (h) =>
        (h.domParentId === parentId || getGoalParents()[h.goalId] === parentId) &&
        h.goalId !== parentId,
    );

    const subCount = parseSubgoalCountFromDom(parentHandle.wrapper);

    let isComplete = false;
    if (subCount === 1) {
      isComplete =
        childRows.length > 0 &&
        childRows.every((h) => (h.goalId === goalId ? true : isGoalChecked(h.wrapper)));
    } else if (subCount !== null && subCount > 1) {
      isComplete =
        childRows.length >= subCount &&
        childRows.every((h) => (h.goalId === goalId ? true : isGoalChecked(h.wrapper)));
    } else if (childRows.length > 0) {
      isComplete = childRows.every((h) =>
        h.goalId === goalId ? true : isGoalChecked(h.wrapper),
      );
    }

    if (isComplete) {
      const parentCb = getNativeGoalCheckbox(parentHandle.wrapper);
      if (parentCb) {
        triggerNativeCheckboxClick(parentCb);
        showToast("✓ All subgoals complete — parent goal completed!");
      }
      currGoalId = parentId;
    } else {
      break;
    }
  }
}

/** Uncheck DOM ancestors recursively (Full reverse cascade). */
function uncheckDomCascade(goalId: string): void {
  const rows = scanGoalRows();
  let currGoalId = goalId;

  while (currGoalId) {
    const childHandle = rows.get(currGoalId);
    const parentId = childHandle?.domParentId || getGoalParents()[currGoalId];
    if (!parentId) break;

    const parentHandle = rows.get(parentId);
    if (parentHandle && isGoalChecked(parentHandle.wrapper)) {
      const parentCb = getNativeGoalCheckbox(parentHandle.wrapper);
      if (parentCb) {
        triggerNativeCheckboxClick(parentCb);
      }
    }
    currGoalId = parentId;
  }
}

/**
 * Handle a user's click on a native goal checkbox.
 * `willBeChecked` is captured synchronously at the moment of click.
 */
function handleCheckboxAction(
  goalId: string,
  _wrapper: HTMLElement,
  willBeChecked: boolean,
): void {
  const settings = getSettings();
  if (settings.autoCompleteParent === false) return;

  if (!willBeChecked) {
    // UNCHECK ACTION:
    // When any subgoal is unchecked, any ancestor above it can no longer be complete.
    uncheckDomCascade(goalId);

    // Authoritative background uncheck on Timestripe API
    void sendToBg<AutoCompleteParentResult>({
      type: "AUTO_COMPLETE_PARENT",
      goalId,
      checked: false,
    }).then((res) => {
      if (!res?.ok || !res.data) return;
      const { parentIdsToUncheck } = res.data;
      if (parentIdsToUncheck && parentIdsToUncheck.length > 0) {
        for (const pId of parentIdsToUncheck) {
          const pWrapper = document.querySelector<HTMLElement>(
            `.GoalRowWrapper[data-draggable-id*='::goal:${pId}']`,
          );
          if (pWrapper && isGoalChecked(pWrapper)) {
            const pCb = getNativeGoalCheckbox(pWrapper);
            if (pCb) triggerNativeCheckboxClick(pCb);
          }
        }
      }
    });
  } else {
    // CHECK ACTION:
    // 0ms instant DOM check cascade
    checkDomCascade(goalId);

    // Authoritative background check on Timestripe API
    void sendToBg<AutoCompleteParentResult>({
      type: "AUTO_COMPLETE_PARENT",
      goalId,
      checked: true,
    }).then((res) => {
      if (!res?.ok || !res.data) return;
      const { parentIdsToCheck } = res.data;
      if (parentIdsToCheck && parentIdsToCheck.length > 0) {
        for (const pId of parentIdsToCheck) {
          const pWrapper = document.querySelector<HTMLElement>(
            `.GoalRowWrapper[data-draggable-id*='::goal:${pId}']`,
          );
          if (pWrapper && !isGoalChecked(pWrapper)) {
            const pCb = getNativeGoalCheckbox(pWrapper);
            if (pCb) {
              triggerNativeCheckboxClick(pCb);
              showToast("✓ All subgoals complete — parent goal completed!");
            }
          }
        }
      }
    });
  }
}

/** Initialize document-level click listener for native checkboxes. */
export function initAutoComplete(): void {
  document.addEventListener(
    "click",
    (e) => {
      if (isProgrammaticClick) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Ignore clicks on TSE extension widgets
      if (
        target.closest(
          "[id^='tse-'], [class*='tse-'], #tse-selection-bar, .tse-dash-overlay, .tse-modal-backdrop",
        )
      ) {
        return;
      }

      // Detect click on the native checkbox element or inside it
      const cb = target.closest<HTMLElement>(
        '[role="checkbox"], input[type="checkbox"], button[class*="check" i], div[class*="check" i]',
      );
      if (!cb) return;

      const wrapper = cb.closest<HTMLElement>(".GoalRowWrapper");
      if (!wrapper) return;

      const goalId = goalIdFromWrapper(wrapper);
      if (!goalId) return;

      // Capture the exact state in capturing phase before the click alters anything:
      const wasChecked = isGoalChecked(wrapper);
      const willBeChecked = !wasChecked;

      if (!willBeChecked) {
        // User clicked to UNCHECK an already-checked goal!
        // Check if this goal has checked subgoals in DOM:
        const rows = scanGoalRows();
        const checkedKidsInDom = Array.from(rows.values())
          .filter(
            (h) =>
              (h.domParentId === goalId || getGoalParents()[h.goalId] === goalId) &&
              h.goalId !== goalId &&
              isGoalChecked(h.wrapper),
          )
          .map((h) => h.goalId);

        if (checkedKidsInDom.length > 0) {
          // Has completed subgoals in current DOM view: prompt user with popover!
          e.preventDefault();
          e.stopPropagation();
          showUncheckParentPopover(goalId, cb, checkedKidsInDom);
          return;
        }

        const subCount = parseSubgoalCountFromDom(wrapper);
        if (subCount && subCount > 0) {
          // Subgoals exist on this goal, but may be collapsed or in another column.
          // Intercept and ask background service worker:
          e.preventDefault();
          e.stopPropagation();
          void sendToBg<CheckSubgoalsStatusResult>({
            type: "CHECK_SUBGOALS_STATUS",
            goalId,
          }).then((res) => {
            if (res?.ok && res.data?.hasCheckedSubgoals) {
              showUncheckParentPopover(goalId, cb, res.data.childIds ?? []);
            } else {
              // No subgoals completed: uncheck directly
              triggerNativeCheckboxClick(cb);
              handleCheckboxAction(goalId, wrapper, false);
            }
          });
          return;
        }

        // Leaf task with no subgoals: uncheck directly
        handleCheckboxAction(goalId, wrapper, false);
      } else {
        // User is checking an unchecked goal
        handleCheckboxAction(goalId, wrapper, true);
      }
    },
    true, // Capturing phase: guarantees state is inspected BEFORE React handles click
  );
}
