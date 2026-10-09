/**
 * Auto-complete parent goals when all subgoals are completed.
 * Features:
 * - Deterministic intent capture: determines check vs uncheck at the instant of click in the capturing phase.
 * - Auto-uncheck: unchecking any subgoal immediately unchecks the parent goal. An uncheck action NEVER checks any parent!
 * - Multi-level cascade (Day -> Week -> Month): only auto-completes an ancestor when 100% of its subgoals are truly complete.
 * - Prevents premature completion: never assumes visible DOM rows equal total subgoals.
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
    cb.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
    );
  }
  setTimeout(() => {
    isProgrammaticClick = false;
  }, 400);
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

/**
 * Handle a user's click on a native goal checkbox.
 * `willBeChecked` is captured synchronously at the moment of click:
 * - true: the user is checking an unchecked goal.
 * - false: the user is unchecking an already-checked goal.
 */
function handleCheckboxAction(
  goalId: string,
  _wrapper: HTMLElement,
  willBeChecked: boolean,
): void {
  const settings = getSettings();
  if (settings.autoCompleteParent === false) return;

  if (!willBeChecked) {
    // =========================================================================
    // UNCHECK ACTION:
    // When any subgoal is unchecked, the parent goal is NO LONGER fully complete!
    // Uncheck the parent goal in the DOM immediately (0ms visual reactivity).
    // An uncheck action CAN NEVER check any ancestor!
    // =========================================================================
    const rows = scanGoalRows();
    const childHandle = rows.get(goalId);
    const parentId = childHandle?.domParentId || getGoalParents()[goalId];

    if (parentId) {
      const parentHandle = rows.get(parentId);
      if (parentHandle && isGoalChecked(parentHandle.wrapper)) {
        const parentCb = getNativeGoalCheckbox(parentHandle.wrapper);
        if (parentCb) {
          triggerNativeCheckboxClick(parentCb);
        }
      }
    }

    // Authoritative background uncheck on Timestripe API (recursively handles grandparents)
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
    // =========================================================================
    // CHECK ACTION:
    // A subgoal is being checked.
    // Can we check the parent in the DOM immediately?
    // ONLY if the parent explicitly has 1 single subgoal ("1 subgoal" in DOM)!
    // If it has multiple subgoals (e.g. "4 subgoals"), we MUST NOT check it from DOM!
    // We let the background service worker verify with Timestripe API that ALL
    // subgoals are truly complete before marking the parent done.
    // =========================================================================
    const rows = scanGoalRows();
    const childHandle = rows.get(goalId);
    const parentId = childHandle?.domParentId || getGoalParents()[goalId];

    if (parentId) {
      const parentHandle = rows.get(parentId);
      if (parentHandle && !isGoalChecked(parentHandle.wrapper)) {
        const subCount = parseSubgoalCountFromDom(parentHandle.wrapper);
        // Instant check only if parent has exactly 1 subgoal (which was just checked)
        if (subCount === 1) {
          const parentCb = getNativeGoalCheckbox(parentHandle.wrapper);
          if (parentCb) {
            triggerNativeCheckboxClick(parentCb);
            showToast("✓ Subgoal complete — parent goal completed!");
          }
        }
      }
    }

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
      // If it was checked -> user is UNCHECKING (willBeChecked = false).
      // If it was unchecked -> user is CHECKING (willBeChecked = true).
      const wasChecked = isGoalChecked(wrapper);
      const willBeChecked = !wasChecked;

      handleCheckboxAction(goalId, wrapper, willBeChecked);
    },
    true, // Capturing phase: guarantees state is inspected BEFORE React handles click
  );
}
