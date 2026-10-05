/**
 * Windows Desktop-style Marquee Selection (PRD §11).
 * Click & drag on empty areas to draw a translucent blue selection box
 * and select all intersecting goal tasks.
 */

import { goalIdFromWrapper } from "./adapter";
import { getSelectedIds, selectMultiple } from "./selection-state";

let isDragging = false;
let startX = 0;
let startY = 0;
let marqueeEl: HTMLDivElement | null = null;
let initialSelection: Set<string> = new Set();
let isAdditive = false;

function injectMarqueeStyles(): void {
  if (document.getElementById("tse-marquee-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-marquee-styles";
  style.textContent = `
    .tse-marquee-box {
      position: fixed;
      border: 1.5px solid rgba(59, 130, 246, 0.85);
      background: rgba(59, 130, 246, 0.18);
      border-radius: 4px;
      pointer-events: none;
      z-index: 2147483640;
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(style);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      ".tse-dash-overlay, .tse-dash-box, .tse-modal-backdrop, .tse-tpl-modal-box, .tse-dup-modal, .tse-scheduler-box, [role='dialog'], .Modal",
    )
  ) {
    return true;
  }
  return Boolean(
    target.closest(
      'button, input, textarea, a, select, [role="checkbox"], [role="menu"], [role="menuitem"], [contenteditable="true"], .tse-select-btn, #tse-selection-bar, .tse-flyout, .tse-modal-backdrop, .tse-bar-flyout, .GoalRow-title, .GoalRow-content [class*="text" i]',
    ),
  );
}

function getIntersectingGoalIds(boxRect: { left: number; top: number; right: number; bottom: number }): string[] {
  const wrappers = document.querySelectorAll<HTMLElement>(".GoalRowWrapper");
  const result: string[] = [];

  for (const wrapper of wrappers) {
    const goalId = goalIdFromWrapper(wrapper);
    if (!goalId) continue;
    const row = wrapper.querySelector<HTMLElement>(".GoalRow") ?? wrapper;
    const rect = row.getBoundingClientRect();

    // Check intersection between row rect and marquee box
    const intersects = !(
      rect.right < boxRect.left ||
      rect.left > boxRect.right ||
      rect.bottom < boxRect.top ||
      rect.top > boxRect.bottom
    );

    if (intersects) {
      result.push(goalId);
    }
  }

  return result;
}

export function initMarqueeSelection(): () => void {
  injectMarqueeStyles();

  const onPointerDown = (e: PointerEvent) => {
    // If dashboard modal or any modal is currently open, do not start marquee
    if (document.querySelector(".tse-dash-overlay, .tse-modal-backdrop, [role='dialog'], .Modal")) return;

    // Left-click only
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;

    startX = e.clientX;
    startY = e.clientY;
    isDragging = false;
    isAdditive = e.shiftKey || e.ctrlKey || e.metaKey;
    initialSelection = new Set(isAdditive ? getSelectedIds() : []);

    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
  };

  const onPointerMove = (e: PointerEvent) => {
    const currentX = e.clientX;
    const currentY = e.clientY;
    const dx = Math.abs(currentX - startX);
    const dy = Math.abs(currentY - startY);

    if (!isDragging && (dx > 5 || dy > 5)) {
      isDragging = true;
      document.body.style.userSelect = "none";

      if (!marqueeEl) {
        marqueeEl = document.createElement("div");
        marqueeEl.className = "tse-marquee-box";
        document.body.appendChild(marqueeEl);
      }
    }

    if (!isDragging || !marqueeEl) return;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const right = Math.max(startX, currentX);
    const bottom = Math.max(startY, currentY);

    marqueeEl.style.left = `${left}px`;
    marqueeEl.style.top = `${top}px`;
    marqueeEl.style.width = `${right - left}px`;
    marqueeEl.style.height = `${bottom - top}px`;

    // Real-time intersection preview
    const intersectingIds = getIntersectingGoalIds({ left, top, right, bottom });
    const combinedIds = new Set(initialSelection);
    for (const id of intersectingIds) combinedIds.add(id);

    selectMultiple(Array.from(combinedIds), false);
  };

  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove, { capture: true });
    window.removeEventListener("pointerup", onPointerUp, { capture: true });

    document.body.style.userSelect = "";

    if (marqueeEl) {
      marqueeEl.remove();
      marqueeEl = null;
    }

    isDragging = false;
  };

  document.addEventListener("pointerdown", onPointerDown, { capture: false });

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, { capture: false });
    window.removeEventListener("pointermove", onPointerMove, { capture: true });
    window.removeEventListener("pointerup", onPointerUp, { capture: true });
    if (marqueeEl) marqueeEl.remove();
  };
}
