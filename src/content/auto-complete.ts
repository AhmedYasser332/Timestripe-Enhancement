/**
 * Auto-complete parent goals when all subgoals are completed.
 * Features:
 * - 0ms instant DOM reactivity: checks if all visible sibling subgoals of a parent are checked,
 *   and programmatically checks the parent goal immediately.
 * - Deep multi-level cascade (Day -> Week -> Month) synced with Timestripe API via service worker.
 * - Auto-uncheck: if a subgoal is unchecked, automatically unchecks the parent goal.
 * - Controlled by setting `autoCompleteParent` (default true).
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
import type { AutoCompleteParentResult } from "../shared/messages";

let isProgrammaticClick = false;

function triggerNativeCheckboxClick(cb: HTMLElement): void {
  isProgrammaticClick = true;
  try {
    cb.click();
  } catch {
    cb.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }
  setTimeout(() => {
    isProgrammaticClick = false;
  }, 350);
}

/** Check DOM siblings and auto-complete parent immediately in the page. */
function checkDomAncestors(goalId: string, isChecked: boolean): void {
  const rows = scanGoalRows();
  const childHandle = rows.get(goalId);
  const parentId = childHandle?.domParentId || getGoalParents()[goalId];
  if (!parentId) return;

  const parentHandle = rows.get(parentId);
  if (!parentHandle) return;

  const parentCb = getNativeGoalCheckbox(parentHandle.wrapper);
  if (!parentCb) return;

  const parentChecked = isGoalChecked(parentHandle.wrapper);

  if (isChecked) {
    // Child was checked: find all visible siblings belonging to this parent
    const siblings = Array.from(rows.values()).filter(
      (h) => (h.domParentId || getGoalParents()[h.goalId]) === parentId,
    );

    const allSiblingsChecked =
      siblings.length > 0 && siblings.every((h) => isGoalChecked(h.wrapper));

    if (allSiblingsChecked && !parentChecked) {
      triggerNativeCheckboxClick(parentCb);
      showToast("✓ All subgoals complete — parent goal completed!");
    }
  } else {
    // Child was unchecked: if parent was checked, uncheck it!
    if (parentChecked) {
      triggerNativeCheckboxClick(parentCb);
    }
  }
}

/** Handler called whenever a native goal checkbox is clicked. */
function handleCheckboxClick(goalId: string, wrapper: HTMLElement): void {
  if (isProgrammaticClick) return;

  const settings = getSettings();
  if (settings.autoCompleteParent === false) return;

  // Wait 60ms for Timestripe's own React state to update the clicked checkbox in DOM
  setTimeout(() => {
    const isChecked = isGoalChecked(wrapper);

    // 1. Instant DOM check (0ms visual feedback)
    checkDomAncestors(goalId, isChecked);

    // 2. Authoritative background sync across all Horizons & columns (Day -> Week -> Month)
    void (async () => {
      const res = await sendToBg<AutoCompleteParentResult>({
        type: "AUTO_COMPLETE_PARENT",
        goalId,
        checked: isChecked,
      });

      if (!res?.ok || !res.data) return;

      const { parentIdsToCheck, parentIdsToUncheck } = res.data;

      // Ensure any ancestors marked checked by server are also checked in the DOM
      if (parentIdsToCheck && parentIdsToCheck.length > 0) {
        for (const pId of parentIdsToCheck) {
          const pWrapper = document.querySelector<HTMLElement>(
            `.GoalRowWrapper[data-draggable-id*='::goal:${pId}']`,
          );
          if (pWrapper && !isGoalChecked(pWrapper)) {
            const cb = getNativeGoalCheckbox(pWrapper);
            if (cb) triggerNativeCheckboxClick(cb);
          }
        }
      }

      // Ensure any ancestors marked unchecked by server are unchecked in DOM
      if (parentIdsToUncheck && parentIdsToUncheck.length > 0) {
        for (const pId of parentIdsToUncheck) {
          const pWrapper = document.querySelector<HTMLElement>(
            `.GoalRowWrapper[data-draggable-id*='::goal:${pId}']`,
          );
          if (pWrapper && isGoalChecked(pWrapper)) {
            const cb = getNativeGoalCheckbox(pWrapper);
            if (cb) triggerNativeCheckboxClick(cb);
          }
        }
      }
    })();
  }, 60);
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

      handleCheckboxClick(goalId, wrapper);
    },
    true, // Capturing phase
  );
}
