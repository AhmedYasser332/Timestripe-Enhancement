/**
 * Renders project indicators and task progress badges on goal rows (PRD §9, §10).
 * Rendering is reconciling: every call converges the row to the desired state, so renames,
 * recolors, reassignments, progress changes and mode switches all apply without a page refresh.
 */

import { hexToRgbTriple } from "../shared/colors";
import type { AssignmentInfo, Settings, TaskTextConfig } from "../shared/types";
import { openProgressPopover } from "./progress-popover";

const STRIP_CLASS = "tse-strip";
const CHIP_CLASS = "tse-badge";
const PROG_CLASS = "tse-progress-badge";

/**
 * One-time style injection.
 * The chip is styled as an elevated, 3D glossy pill with specular top highlights,
 * crisp stroke, and razor-sharp contrast so it pops cleanly against any row background.
 */
export function injectStyles(): void {
  if (document.getElementById("tse-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-styles";
  style.textContent = `
    .GoalRow[data-tse-mode="strip"] {
      position: relative;
    }
    .GoalRow[data-tse-mode="full"] {
      background-color: rgb(var(--tse-color) / 0.14) !important;
      border-radius: 8px;
    }
    .GoalRow[data-tse-mode="full"]:hover {
      background-color: rgb(var(--tse-color) / 0.22) !important;
    }
    .${STRIP_CLASS} {
      position: absolute;
      inset-inline-start: 0;
      top: 5px;
      bottom: 5px;
      width: 3.5px;
      border-radius: 2px;
      background: rgb(var(--tse-color));
      box-shadow: 0 0 8px rgb(var(--tse-color) / 0.45);
      pointer-events: none;
    }

    /* GoalRow and content layout */
    .GoalRowWrapper:hover,
    .GoalRow:hover,
    .GoalRow-content:hover {
      overflow: visible !important;
    }
    .GoalRow-content {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      width: 100%;
      min-width: 0;
      position: relative;
      row-gap: 2px;
    }

    /* Protect task titles from breaking letter by letter vertically and prevent unnecessary truncation */
    .GoalRow-title,
    .GoalRow-content [class*="title" i] {
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      word-break: keep-all !important;
      overflow-wrap: normal !important;
      min-width: 32px !important;
      flex: 1 1 auto !important;
      display: inline-block !important;
      vertical-align: middle !important;
    }

    /* Project badge pill — rock solid in-flow layout with zero jitter */
    .${CHIP_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-inline-start: auto;
      margin-inline-end: 2px;
      padding: 2px 7px 2px 5px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.35;
      white-space: nowrap;
      min-width: 18px;
      max-width: 48%;
      flex-shrink: 1;
      box-sizing: border-box;
      overflow: hidden;
      user-select: none;
      pointer-events: auto;
      cursor: pointer;
      vertical-align: middle;
      position: relative;

      background: rgba(24, 24, 27, 0.85);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
      color: #f4f4f5 !important;
      letter-spacing: 0.01em;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .${CHIP_CLASS}:hover {
      border-color: rgba(255, 255, 255, 0.35) !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6) !important;
    }
    .${CHIP_CLASS} .tse-chip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: inline-block;
      max-width: 100%;
      padding-inline-end: 2px;
    }
    .tse-chip-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      background: rgb(var(--tse-color));
      box-shadow: 0 0 5px rgb(var(--tse-color) / 0.7);
    }

    /* Floating Expanded Pill on Body (zero layout shift, 0.00% jitter) */
    .tse-float-pill {
      position: fixed;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2.5px 9px 2.5px 7px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      color: #f4f4f5;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.35);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.22);
      white-space: nowrap;
      pointer-events: none;
      z-index: 2147483647;
      animation: tseFadeIn 0.08s ease-out;
    }

    /* Task Progress / Remaining Badge */
    .${PROG_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      margin-inline-start: 2px;
      margin-inline-end: 6px;
      padding: 1.5px 5.5px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      line-height: 1.25;
      white-space: nowrap;
      flex-shrink: 0;
      cursor: pointer;
      user-select: none;
      vertical-align: middle;
      background: rgba(124, 92, 255, 0.18);
      border: 1px solid rgba(124, 92, 255, 0.4);
      color: #d8b4fe !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
      transition: background 0.12s ease, border-color 0.12s ease, transform 0.08s ease;
    }
    .${PROG_CLASS}:hover {
      background: rgba(124, 92, 255, 0.32);
      border-color: rgba(124, 92, 255, 0.65);
      color: #ffffff !important;
      transform: scale(1.04);
    }
    .${PROG_CLASS}:active {
      transform: scale(0.96);
    }

    /* Per-task Text Direction & Alignment (PRD §36.1) */
    .GoalRow[data-tse-dir="rtl"],
    .GoalRow[data-tse-dir="rtl"] .GoalRow-content,
    .GoalRow[data-tse-dir="rtl"] .GoalRow-title,
    .GoalRow[data-tse-dir="rtl"] [class*="title" i],
    .GoalRow[data-tse-dir="rtl"] textarea,
    .GoalRow[data-tse-dir="rtl"] input {
      direction: rtl !important;
      text-align: right !important;
    }
    .GoalRow[data-tse-dir="ltr"],
    .GoalRow[data-tse-dir="ltr"] .GoalRow-content,
    .GoalRow[data-tse-dir="ltr"] .GoalRow-title,
    .GoalRow[data-tse-dir="ltr"] [class*="title" i],
    .GoalRow[data-tse-dir="ltr"] textarea,
    .GoalRow[data-tse-dir="ltr"] input {
      direction: ltr !important;
      text-align: left !important;
    }
    .GoalRow[data-tse-align="center"],
    .GoalRow[data-tse-align="center"] .GoalRow-title,
    .GoalRow[data-tse-align="center"] [class*="title" i] {
      text-align: center !important;
    }
    .GoalRow[data-tse-align="right"],
    .GoalRow[data-tse-align="right"] .GoalRow-title,
    .GoalRow[data-tse-align="right"] [class*="title" i] {
      text-align: right !important;
    }
    .GoalRow[data-tse-align="left"],
    .GoalRow[data-tse-align="left"] .GoalRow-title,
    .GoalRow[data-tse-align="left"] [class*="title" i] {
      text-align: left !important;
    }
  `;
  document.head.appendChild(style);
  initFloatPillListeners();
}

let floatPillListenersInitialized = false;

function initFloatPillListeners(): void {
  if (floatPillListenersInitialized) return;
  floatPillListenersInitialized = true;

  let activeFloatPill: HTMLElement | null = null;
  let currentHoveredChip: HTMLElement | null = null;

  function removeFloatPill(): void {
    if (activeFloatPill) {
      activeFloatPill.remove();
      activeFloatPill = null;
    }
    currentHoveredChip = null;
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      const target = e.target as HTMLElement | null;
      const chip = target?.closest<HTMLElement>(`.${CHIP_CLASS}`);
      if (!chip) {
        if (activeFloatPill) removeFloatPill();
        return;
      }
      if (chip === currentHoveredChip) return;
      currentHoveredChip = chip;

      const fullName = chip.getAttribute("data-full-name") || chip.textContent?.trim() || "";
      if (!fullName) return;

      removeFloatPill();

      const rect = chip.getBoundingClientRect();
      const dotColor = chip.getAttribute("data-color") || "#888";

      const pill = document.createElement("div");
      pill.className = "tse-float-pill";
      const dot = document.createElement("span");
      dot.className = "tse-chip-dot";
      dot.style.background = dotColor;
      dot.style.boxShadow = `0 0 5px ${dotColor}`;
      const label = document.createElement("span");
      label.textContent = fullName;
      pill.append(dot, label);
      document.body.appendChild(pill);
      activeFloatPill = pill;

      const pillRect = pill.getBoundingClientRect();
      pill.style.top = `${rect.top}px`;
      pill.style.left = `${Math.max(8, rect.right - pillRect.width)}px`;
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    (e) => {
      const target = e.target as HTMLElement | null;
      const chip = target?.closest<HTMLElement>(`.${CHIP_CLASS}`);
      if (chip && chip === currentHoveredChip) {
        const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
        if (related && chip.contains(related)) return;
        removeFloatPill();
      }
    },
    true,
  );

  window.addEventListener("scroll", removeFloatPill, { passive: true, capture: true });
  window.addEventListener("resize", removeFloatPill, { passive: true });
}

function signature(
  info: AssignmentInfo | null,
  settings: Settings,
  textConfig?: TaskTextConfig | null,
  progressNote?: string | null,
): string {
  const parts: string[] = [];
  if (info) {
    parts.push(settings.colorMode, info.color, settings.showProjectName ? info.name : "", info.colorSource);
  } else {
    parts.push("none");
  }
  if (textConfig) {
    parts.push(textConfig.direction ?? "auto", textConfig.alignment ?? "none");
  }
  if (progressNote) {
    parts.push(progressNote);
  }
  return parts.join("|");
}

/** React may re-render parts of the row and drop our nodes — detect that so we re-add them. */
function isIntact(
  row: HTMLElement,
  settings: Settings,
  hasInfo: boolean,
  hasProgress: boolean,
): boolean {
  if (hasInfo) {
    if (settings.colorMode === "strip" && !row.querySelector(`:scope > .${STRIP_CLASS}`)) return false;
    if (settings.showProjectName && !row.querySelector(`.${CHIP_CLASS}`)) return false;
  } else {
    if (row.querySelector(`.${CHIP_CLASS}`)) return false;
  }
  if (hasProgress) {
    if (!row.querySelector(`.${PROG_CLASS}`)) return false;
  } else {
    if (row.querySelector(`.${PROG_CLASS}`)) return false;
  }
  return true;
}

function clearRow(row: HTMLElement): void {
  row.querySelectorAll(`.${STRIP_CLASS}`).forEach((el) => el.remove());
  row.querySelectorAll(`.${CHIP_CLASS}`).forEach((el) => el.remove());
  row.querySelectorAll(`.${PROG_CLASS}`).forEach((el) => el.remove());
  delete row.dataset.tseSig;
  delete row.dataset.tseMode;
  delete row.dataset.tseDir;
  delete row.dataset.tseAlign;
  row.style.removeProperty("--tse-color");
}

/** Converge one goal row to the desired indicator state (null info = no project). */
export function applyBadge(
  goalId: string,
  row: HTMLElement,
  info: AssignmentInfo | null,
  settings: Settings,
  textConfig?: TaskTextConfig | null,
  progressNote?: string | null,
): void {
  const sig = signature(info, settings, textConfig, progressNote);
  const current = row.dataset.tseSig ?? "";
  if (current === sig && isIntact(row, settings, Boolean(info), Boolean(progressNote))) return;

  clearRow(row);

  // Apply Direction & Alignment (PRD §36.1)
  if (textConfig?.direction && textConfig.direction !== "auto") {
    row.dataset.tseDir = textConfig.direction;
  }
  if (textConfig?.alignment) {
    row.dataset.tseAlign = textConfig.alignment;
  }

  row.dataset.tseSig = sig;

  // Purge any existing badges to guarantee no duplicates ever accumulate
  row.querySelectorAll(`.${PROG_CLASS}`).forEach((el) => el.remove());
  row.querySelectorAll(`.${CHIP_CLASS}`).forEach((el) => el.remove());

  const content = row.querySelector<HTMLElement>(":scope > .GoalRow-content");

  // Render Progress / Remaining Badge if set
  if (progressNote && content) {
    const progBadge = document.createElement("span");
    progBadge.className = PROG_CLASS;
    const icon = progressNote.includes("⏳") || progressNote.includes("✓") || progressNote.includes("%") ? "" : "⏳ ";
    progBadge.textContent = `${icon}${progressNote}`;
    progBadge.title = `Progress: ${progressNote} (click to edit or clear)`;
    progBadge.onclick = (e) => {
      e.stopPropagation();
      openProgressPopover(goalId, progBadge);
    };

    content.appendChild(progBadge);
  }

  if (!info) return;

  const [r, g, b] = hexToRgbTriple(info.color);
  row.dataset.tseMode = settings.colorMode;
  row.style.setProperty("--tse-color", `${r} ${g} ${b}`);

  if (settings.colorMode === "strip") {
    const strip = document.createElement("div");
    strip.className = STRIP_CLASS;
    row.prepend(strip);
  }

  if (settings.showProjectName && info.name && content) {
    const chip = document.createElement("span");
    chip.className = CHIP_CLASS;
    chip.title = `${info.path ?? info.name} (${info.source})${info.colorSource === "override" ? " • Custom color" : ""}`;
    chip.setAttribute("data-full-name", info.path ?? info.name);
    chip.setAttribute("data-color", info.color);
    const dot = document.createElement("span");
    dot.className = "tse-chip-dot";
    const label = document.createElement("span");
    label.className = "tse-chip-label";
    label.dir = "auto";
    label.textContent = info.name;
    chip.append(dot, label);

    const progEl = content.querySelector(`.${PROG_CLASS}`);
    if (progEl) {
      content.insertBefore(chip, progEl);
    } else {
      content.appendChild(chip);
    }
  }
}
