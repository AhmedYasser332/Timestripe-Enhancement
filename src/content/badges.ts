/**
 * Renders project indicators on goal rows — Strip Mode and Full Color Mode (PRD §9, §10).
 * Rendering is reconciling: every call converges the row to the desired state, so renames,
 * recolors, reassignments and mode switches all apply without a page refresh.
 */

import { hexToRgbTriple } from "../shared/colors";
import type { AssignmentInfo, Settings, TaskTextConfig } from "../shared/types";

const STRIP_CLASS = "tse-strip";
// NOTE: must NOT be "tse-chip" — that class belongs to the interactive
// dashboard chips; styling this badge with the same name once leaked
// `pointer-events: none` onto them and froze every chip click in the UI.
const CHIP_CLASS = "tse-badge";

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
    .${CHIP_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-inline-start: 10px;
      margin-inline-end: 4px;
      padding: 2.5px 9px 2.5px 7px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.35;
      white-space: nowrap;
      flex-shrink: 0;
      user-select: none;
      pointer-events: none;

      background: rgba(24, 24, 27, 0.88);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.11);
      border-top-color: rgba(255, 255, 255, 0.22);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.14),
        0 2px 4px rgba(0, 0, 0, 0.35);
      color: #f4f4f5 !important;
      letter-spacing: 0.01em;
    }
    .tse-chip-dot {
      width: 6.5px;
      height: 6.5px;
      border-radius: 50%;
      flex-shrink: 0;
      background: rgb(var(--tse-color));
      box-shadow: 0 0 5px rgb(var(--tse-color) / 0.7);
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
}

function signature(info: AssignmentInfo | null, settings: Settings, textConfig?: TaskTextConfig | null): string {
  const parts: string[] = [];
  if (info) {
    parts.push(settings.colorMode, info.color, settings.showProjectName ? info.name : "", info.colorSource);
  } else {
    parts.push("none");
  }
  if (textConfig) {
    parts.push(textConfig.direction ?? "auto", textConfig.alignment ?? "none");
  }
  return parts.join("|");
}

/** React may re-render parts of the row and drop our nodes — detect that so we re-add them. */
function isIntact(row: HTMLElement, settings: Settings, hasInfo: boolean): boolean {
  if (hasInfo) {
    if (settings.colorMode === "strip" && !row.querySelector(`:scope > .${STRIP_CLASS}`)) return false;
    if (settings.showProjectName && !row.querySelector(`:scope > .GoalRow-content > .${CHIP_CLASS}`)) return false;
  }
  return true;
}

function clearRow(row: HTMLElement): void {
  row.querySelectorAll(`:scope > .${STRIP_CLASS}`).forEach((el) => el.remove());
  row.querySelectorAll(`:scope > .GoalRow-content > .${CHIP_CLASS}`).forEach((el) => el.remove());
  delete row.dataset.tseSig;
  delete row.dataset.tseMode;
  delete row.dataset.tseDir;
  delete row.dataset.tseAlign;
  row.style.removeProperty("--tse-color");
}

/** Converge one goal row to the desired indicator state (null info = no project). */
export function applyBadge(
  row: HTMLElement,
  info: AssignmentInfo | null,
  settings: Settings,
  textConfig?: TaskTextConfig | null,
): void {
  const sig = signature(info, settings, textConfig);
  const current = row.dataset.tseSig ?? "";
  if (current === sig && isIntact(row, settings, Boolean(info))) return;

  clearRow(row);

  // Apply Direction & Alignment (PRD §36.1)
  if (textConfig?.direction && textConfig.direction !== "auto") {
    row.dataset.tseDir = textConfig.direction;
  }
  if (textConfig?.alignment) {
    row.dataset.tseAlign = textConfig.alignment;
  }

  row.dataset.tseSig = sig;

  if (!info) return;

  const [r, g, b] = hexToRgbTriple(info.color);
  row.dataset.tseMode = settings.colorMode;
  row.style.setProperty("--tse-color", `${r} ${g} ${b}`);

  if (settings.colorMode === "strip") {
    const strip = document.createElement("div");
    strip.className = STRIP_CLASS;
    row.prepend(strip);
  }

  if (settings.showProjectName && info.name) {
    const content = row.querySelector<HTMLElement>(":scope > .GoalRow-content");
    if (content) {
      const chip = document.createElement("span");
      chip.className = CHIP_CLASS;
      // For sub-projects the badge shows the sub's own name; the full
      // "root › … › leaf" path lives in the tooltip (user decision 2026-10-05).
      chip.title = `${info.path ?? info.name} (${info.source})${info.colorSource === "override" ? " • Custom color" : ""}`;
      const dot = document.createElement("span");
      dot.className = "tse-chip-dot";
      const label = document.createElement("span");
      label.dir = "auto";
      label.textContent = info.name;
      chip.append(dot, label);
      content.appendChild(chip);
    }
  }
}
