/**
 * Editor Toolbar Integration (PRD §36.1).
 * Injects Text Direction (RTL/LTR) and Alignment (Left/Center/Right) dropdown
 * directly into Timestripe's floating formatting toolbar (both on the Horizon board and in modals).
 * Matches the exact UI dropdown options:
 * - Auto (Default)
 * - Right-to-Left (RTL) ⇄
 * - Left-to-Right (LTR) ⇄
 * - Align Left ⫷
 * - Align Center ≡
 * - Align Right ⫸
 */

import { goalIdFromWrapper } from "./adapter";
import { pushAction } from "./history";
import { sendToBg } from "./messaging";
import { getTaskTextConfigs, optimisticTextConfig } from "./state";
import { showToast } from "./toast";
import type { TaskTextConfig } from "../shared/types";

const TOOLBAR_INJECTED_CLASS = "tse-editor-tools";
const FLYOUT_CLASS = "tse-editor-flyout";

let activeFlyoutEl: HTMLElement | null = null;

function closeEditorFlyout(): void {
  if (activeFlyoutEl) {
    activeFlyoutEl.remove();
    activeFlyoutEl = null;
  }
}

// Global dismiss on click outside or Escape
document.addEventListener("pointerdown", (e) => {
  if (activeFlyoutEl && !(e.target as Element | null)?.closest(`.${FLYOUT_CLASS}`) && !(e.target as Element | null)?.closest(".tse-editor-btn-trigger")) {
    closeEditorFlyout();
  }
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEditorFlyout();
});

function detectTargetGoalId(): string | null {
  // 1. Check focused element's wrapper
  const activeEl = document.activeElement;
  const fromActive = activeEl?.closest<HTMLElement>(".GoalRowWrapper");
  if (fromActive) {
    const id = goalIdFromWrapper(fromActive);
    if (id) return id;
  }

  // 2. Check selection anchor's wrapper
  const sel = window.getSelection();
  const anchorEl = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
  const fromSel = anchorEl?.closest<HTMLElement>(".GoalRowWrapper");
  if (fromSel) {
    const id = goalIdFromWrapper(fromSel);
    if (id) return id;
  }

  // 3. Check location pathname for modal (/goals/{id})
  const match = location.pathname.match(/\/goals\/([A-Za-z0-9]{8})/);
  if (match) return match[1];

  // 4. Check modal dialog anchor
  const modal = document.querySelector('[role="dialog"], .Modal, [class*="modal" i]');
  if (modal) {
    const link = modal.querySelector<HTMLAnchorElement>('a[href*="/goals/"]');
    const m = link?.getAttribute("href")?.match(/\/goals\/([A-Za-z0-9]{8})/);
    if (m) return m[1];
  }

  return null;
}

function injectToolbarStyles(): void {
  if (document.getElementById("tse-editor-toolbar-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-editor-toolbar-styles";
  style.textContent = `
    .${TOOLBAR_INJECTED_CLASS} {
      display: inline-flex;
      align-items: center;
      margin-inline-start: 4px;
      vertical-align: middle;
    }
    .tse-editor-sep {
      width: 1px;
      height: 16px;
      background: rgba(255, 255, 255, 0.18);
      margin: 0 4px;
    }
    .tse-editor-btn-trigger {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      height: 24px;
      padding: 0 6px;
      border-radius: 4px;
      border: none;
      background: none;
      color: #d4d4d8;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s ease;
      user-select: none;
      font-family: inherit;
    }
    .tse-editor-btn-trigger:hover,
    .tse-editor-btn-trigger.active {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }

    .${FLYOUT_CLASS} {
      position: fixed;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
      z-index: 2147483647;
      min-width: 190px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      animation: tseFadeIn 0.12s ease-out;
    }

    /* Direction & Alignment overrides on editor elements */
    [data-tse-dir="rtl"],
    [data-tse-dir="rtl"] .ProseMirror,
    [data-tse-dir="rtl"] [contenteditable="true"],
    [data-tse-dir="rtl"] [class*="title" i],
    [data-tse-dir="rtl"] input,
    [data-tse-dir="rtl"] textarea {
      direction: rtl !important;
      text-align: right !important;
    }

    [data-tse-dir="ltr"],
    [data-tse-dir="ltr"] .ProseMirror,
    [data-tse-dir="ltr"] [contenteditable="true"],
    [data-tse-dir="ltr"] [class*="title" i],
    [data-tse-dir="ltr"] input,
    [data-tse-dir="ltr"] textarea {
      direction: ltr !important;
      text-align: left !important;
    }

    [data-tse-align="center"],
    [data-tse-align="center"] .ProseMirror,
    [data-tse-align="center"] [contenteditable="true"] {
      text-align: center !important;
    }
    [data-tse-align="right"],
    [data-tse-align="right"] .ProseMirror,
    [data-tse-align="right"] [contenteditable="true"] {
      text-align: right !important;
    }
    [data-tse-align="left"],
    [data-tse-align="left"] .ProseMirror,
    [data-tse-align="left"] [contenteditable="true"] {
      text-align: left !important;
    }
  `;
  document.head.appendChild(style);
}

function isFormattingButton(btn: HTMLElement): boolean {
  const text = (btn.textContent ?? "").trim();
  const label = (btn.getAttribute("aria-label") ?? btn.getAttribute("title") ?? "").toLowerCase();
  if (text === "B" || text === "I" || text === "S" || text === "H2" || text === "H3" || text === "H₂") return true;
  if (
    label.includes("bold") ||
    label.includes("italic") ||
    label.includes("strike") ||
    label.includes("heading") ||
    label.includes("quote") ||
    label.includes("bullet") ||
    label.includes("numbered")
  ) {
    return true;
  }
  return false;
}

function isMetaOrFooterToolbar(el: HTMLElement): boolean {
  // Check if it is the modal bottom metadata bar or footer
  const text = (el.textContent ?? "").toLowerCase();
  if (
    text.includes("assignee") ||
    text.includes("comment") ||
    text.includes("add note") ||
    text.includes("attachment")
  ) {
    return true;
  }
  if (el.closest('[class*="footer" i], [class*="bottom" i], .GoalModal__bottom')) return true;
  if (el.querySelector('[class*="comment" i], [class*="assignee" i], [class*="attach" i]')) return true;
  return false;
}

function isValidFormattingToolbar(el: HTMLElement): boolean {
  if (isMetaOrFooterToolbar(el)) return false;
  const buttons = Array.from(el.querySelectorAll<HTMLElement>("button"));
  const formatButtons = buttons.filter(isFormattingButton);
  // Must have at least one bold button or multiple rich-text formatting buttons
  return formatButtons.length >= 2 || (formatButtons.length >= 1 && buttons.some((b) => (b.textContent ?? "").trim() === "B"));
}

function findFormattingToolbars(): HTMLElement[] {
  const candidates: HTMLElement[] = [];

  // 1. Detect button with "B" having rich text formatting siblings
  for (const btn of document.querySelectorAll<HTMLElement>("button")) {
    const text = (btn.textContent ?? "").trim();
    if (text === "B") {
      const parent = btn.parentElement;
      if (parent && !candidates.includes(parent) && isValidFormattingToolbar(parent)) {
        candidates.push(parent);
      }
    }
  }

  // 2. Detect floating bubble formatting toolbars near ProseMirror/TipTap
  for (const bar of document.querySelectorAll<HTMLElement>('[class*="bubble" i], [class*="tiptap" i]')) {
    if (!candidates.includes(bar) && isValidFormattingToolbar(bar)) {
      candidates.push(bar);
    }
  }

  // Filter out any candidate that is nested inside another candidate
  return candidates.filter((bar) => !candidates.some((other) => other !== bar && other.contains(bar)));
}

async function applyEditorTextConfig(
  patch: Partial<TaskTextConfig> | null,
  labelText: string,
): Promise<void> {
  const goalId = detectTargetGoalId();

  // 1. Apply style directly to focused editor element immediately
  const activeEditor =
    document.querySelector(".ProseMirror:focus") ??
    document.querySelector("[contenteditable='true']:focus") ??
    document.activeElement?.closest(".ProseMirror, [contenteditable='true'], .GoalRow");

  if (activeEditor instanceof HTMLElement) {
    if (patch?.direction) {
      activeEditor.dataset.tseDir = patch.direction;
      activeEditor.style.direction = patch.direction === "rtl" ? "rtl" : patch.direction === "ltr" ? "ltr" : "";
    }
    if (patch?.alignment) {
      activeEditor.dataset.tseAlign = patch.alignment;
      activeEditor.style.textAlign = patch.alignment;
    }
  }

  showToast(labelText);

  // 2. Persist in goal config if goal ID is resolved
  if (goalId) {
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
    await sendToBg({ type: "SET_TASK_TEXT_CONFIG", goalIds: [goalId], patch });
  }
}

function openDropdownMenu(triggerBtn: HTMLElement): void {
  if (activeFlyoutEl) {
    closeEditorFlyout();
    return;
  }

  const goalId = detectTargetGoalId();
  const currentConfig = goalId ? getTaskTextConfigs()[goalId] : null;

  const flyout = document.createElement("div");
  flyout.className = FLYOUT_CLASS;
  activeFlyoutEl = flyout;

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
      e.preventDefault();
      closeEditorFlyout();
      onClick();
    });
    return row;
  };

  // 1. Text Direction Options (Image 4)
  flyout.appendChild(
    makeRow("Auto (Default)", !currentConfig?.direction || currentConfig?.direction === "auto", () => {
      void applyEditorTextConfig({ direction: "auto" }, "Direction: Auto");
    }),
  );
  flyout.appendChild(
    makeRow("Right-to-Left (RTL) ⇄", currentConfig?.direction === "rtl", () => {
      void applyEditorTextConfig({ direction: "rtl", alignment: "right" }, "Direction: RTL (Arabic)");
    }),
  );
  flyout.appendChild(
    makeRow("Left-to-Right (LTR) ⇄", currentConfig?.direction === "ltr", () => {
      void applyEditorTextConfig({ direction: "ltr", alignment: "left" }, "Direction: LTR (English)");
    }),
  );

  const sep = document.createElement("div");
  sep.className = "tse-flyout-sep";
  flyout.appendChild(sep);

  // 2. Alignment Options (Image 4)
  flyout.appendChild(
    makeRow("Align Left ⫷", currentConfig?.alignment === "left", () => {
      void applyEditorTextConfig({ alignment: "left" }, "Align: Left");
    }),
  );
  flyout.appendChild(
    makeRow("Align Center ≡", currentConfig?.alignment === "center", () => {
      void applyEditorTextConfig({ alignment: "center" }, "Align: Center");
    }),
  );
  flyout.appendChild(
    makeRow("Align Right ⫸", currentConfig?.alignment === "right", () => {
      void applyEditorTextConfig({ alignment: "right" }, "Align: Right");
    }),
  );

  document.body.appendChild(flyout);

  // Position right below or above the trigger button
  const rect = triggerBtn.getBoundingClientRect();
  const fw = flyout.offsetWidth;
  const fh = flyout.offsetHeight;

  let left = rect.left;
  if (left + fw > window.innerWidth - 8) left = window.innerWidth - fw - 8;
  if (left < 8) left = 8;

  let top = rect.bottom + 6;
  if (top + fh > window.innerHeight - 8) {
    top = rect.top - fh - 6;
  }

  flyout.style.left = `${Math.max(8, left)}px`;
  flyout.style.top = `${Math.max(8, top)}px`;
}

/** Scans the DOM and injects direction & alignment tools into all formatting toolbars. */
export function scanAndInjectEditorToolbar(): void {
  injectToolbarStyles();

  // Purge any erroneously injected buttons from invalid toolbars/footers
  const allInjected = document.querySelectorAll<HTMLElement>(`.${TOOLBAR_INJECTED_CLASS}`);
  for (const el of allInjected) {
    const parent = el.parentElement;
    if (!parent || !isValidFormattingToolbar(parent)) {
      el.remove();
    }
  }

  const toolbars = findFormattingToolbars();
  for (const toolbar of toolbars) {
    if (toolbar.querySelector(`.${TOOLBAR_INJECTED_CLASS}`)) continue;

    const container = document.createElement("div");
    container.className = TOOLBAR_INJECTED_CLASS;

    const sep = document.createElement("div");
    sep.className = "tse-editor-sep";
    container.appendChild(sep);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "tse-editor-btn-trigger";
    trigger.title = "Text Direction & Alignment (RTL / Align)";
    trigger.innerHTML = `<span>Text</span> <span style="font-size:10px;opacity:0.7">›</span>`;

    trigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDropdownMenu(trigger);
    };

    container.appendChild(trigger);
    toolbar.appendChild(container);
  }
}
