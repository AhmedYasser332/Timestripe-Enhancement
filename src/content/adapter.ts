/**
 * TimestripeDomAdapter (PRD §47) — the single place that knows Timestripe's DOM.
 * Built from Phase 0 probe findings (PRD §41.5.2):
 *   .Goals > .Goals-list > .GoalRowWrapper[data-draggable-id="{listId}::goal:{ID}"]
 *     > … > .GoalRow._is_subgoal > .GoalRow-content > [role="checkbox"]
 */

const GOAL_ID_RE = /::goal:([A-Za-z0-9]{8})$/;

export interface GoalRowHandle {
  goalId: string;
  wrapper: HTMLElement;
  row: HTMLElement;
  domParentId?: string | null;
}

export function goalIdFromWrapper(wrapper: HTMLElement): string | null {
  const draggableId = wrapper.getAttribute("data-draggable-id") ?? "";
  return draggableId.match(GOAL_ID_RE)?.[1] ?? null;
}

/** Detect parent goal ID directly from DOM structure if nested or linked. */
export function detectDomParent(wrapper: HTMLElement, goalId: string): string | null {
  // 1. Nested inside another GoalRowWrapper (subgoal hierarchy)
  const parentWrapper = wrapper.parentElement?.closest<HTMLElement>(".GoalRowWrapper");
  if (parentWrapper) {
    const pid = goalIdFromWrapper(parentWrapper);
    if (pid && pid !== goalId) return pid;
  }

  // 2. Subgoals container following or inside a parent section
  const subgoalsContainer = wrapper.closest<HTMLElement>(
    ".Subgoals, .Subgoals-list, [class*='subgoal' i], [class*='Subgoal']",
  );
  if (subgoalsContainer && !subgoalsContainer.classList.contains("GoalRowWrapper")) {
    let prev = subgoalsContainer.previousElementSibling;
    while (prev && !prev.classList.contains("GoalRowWrapper")) {
      prev = prev.previousElementSibling;
    }
    if (prev instanceof HTMLElement) {
      const pid = goalIdFromWrapper(prev);
      if (pid && pid !== goalId) return pid;
    }
  }

  // 3. Anchor link to parent goal inside the row (e.g. subtitle link in Horizons)
  const parentLink = wrapper.querySelector<HTMLAnchorElement>('a[href*="/goals/"]');
  if (parentLink) {
    const m = parentLink.getAttribute("href")?.match(/\/goals\/([A-Za-z0-9]{8})/);
    if (m && m[1] !== goalId) return m[1];
  }

  return null;
}

/** Scan the page and map every visible goal row to its Timestripe goal ID. */
export function scanGoalRows(root: ParentNode = document): Map<string, GoalRowHandle> {
  const out = new Map<string, GoalRowHandle>();
  for (const wrapper of root.querySelectorAll<HTMLElement>(".GoalRowWrapper")) {
    const goalId = goalIdFromWrapper(wrapper);
    if (!goalId) continue;
    const row = wrapper.querySelector<HTMLElement>(".GoalRow");
    if (!row) continue;
    const domParentId = detectDomParent(wrapper, goalId);
    out.set(goalId, { goalId, wrapper, row, domParentId });
  }
  return out;
}

/** The goal row currently under the cursor (for context-menu actions, PRD §55). */
export function goalIdFromEventTarget(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target.closest<HTMLElement>(".GoalRowWrapper") : null;
  return el ? goalIdFromWrapper(el) : null;
}

export function getNativeGoalCheckbox(wrapperOrRow: HTMLElement): HTMLElement | null {
  // 1. Native Timestripe checkbox with role="checkbox"
  const roleCb = wrapperOrRow.querySelector<HTMLElement>('[role="checkbox"]');
  if (roleCb) return roleCb;

  // 2. Standard input checkbox (excluding TSE custom checkboxes)
  const inputCb = wrapperOrRow.querySelector<HTMLInputElement>(
    'input[type="checkbox"]:not(.tse-select-btn):not([class*="tse-"])',
  );
  if (inputCb) return inputCb;

  // 3. Button or element with class containing check
  const classCb = wrapperOrRow.querySelector<HTMLElement>(
    'button[class*="check" i]:not([class*="tse-"]), div[class*="Checkbox" i]:not([class*="tse-"]), [class*="GoalCheckbox" i]',
  );
  if (classCb) return classCb;

  return null;
}

export function isGoalChecked(wrapperOrRow: HTMLElement): boolean {
  const cb = getNativeGoalCheckbox(wrapperOrRow);
  if (cb) {
    const aria = cb.getAttribute("aria-checked");
    if (aria === "true") return true;
    if (aria === "false") return false;
    if (cb instanceof HTMLInputElement) return cb.checked;
    if (
      cb.classList.contains("checked") ||
      cb.classList.contains("is-checked") ||
      cb.classList.contains("_checked") ||
      cb.classList.contains("_is_done") ||
      cb.classList.contains("is-done") ||
      cb.classList.contains("_done")
    ) {
      return true;
    }
    // An SVG inside the native checkbox is Timestripe's checkmark icon
    if (cb.querySelector("svg")) return true;
  }

  const row = wrapperOrRow.classList.contains("GoalRow")
    ? wrapperOrRow
    : wrapperOrRow.querySelector(".GoalRow");
  if (row) {
    for (const cls of Array.from(row.classList)) {
      if (/done|completed|checked/i.test(cls)) return true;
    }
  }
  for (const cls of Array.from(wrapperOrRow.classList)) {
    if (/done|completed|checked/i.test(cls)) return true;
  }

  const title = wrapperOrRow.querySelector(".GoalRow-title, [class*='title' i]");
  if (title) {
    const cs = window.getComputedStyle(title);
    if (cs.textDecorationLine.includes("line-through")) return true;
  }

  return false;
}

function isTseNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    return parent ? isTseNode(parent) : false;
  }
  if (node instanceof Element) {
    if (node.id.startsWith("tse-")) return true;
    for (const c of Array.from(node.classList)) {
      if (c.startsWith("tse-")) return true;
    }
    if (node.closest("[id^='tse-'], [class*='tse-']")) return true;
  }
  return false;
}

/** Observe re-renders / SPA navigation; calls back debounced. */
export function observeGoalList(onChange: () => void, debounceMs = 150): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        const added = Array.from(m.addedNodes);
        const removed = Array.from(m.removedNodes);
        // ignore mutations consisting entirely of our own injected nodes
        const allOurs =
          added.length + removed.length > 0 &&
          added.every(isTseNode) &&
          removed.every(isTseNode);
        if (allOurs) continue;
        if (added.length > 0 || removed.length > 0) {
          schedule();
          return;
        }
      }
      if (m.type === "attributes" && m.attributeName === "data-route") {
        schedule();
        return;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-route"],
  });
  return observer;
}
