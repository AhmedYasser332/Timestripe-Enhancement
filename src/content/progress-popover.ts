/**
 * Progress & Remaining Time Manager (Quick smart input on right-click or 3-dots menu).
 * Allows users to set completion percentage (e.g. "50%"), remaining minutes (e.g. "15m left"),
 * or hour estimates without losing track of multi-hour tasks.
 */

import { goalIdFromWrapper } from "./adapter";
import { getTaskProgressNotes, optimisticProgressNote } from "./state";
import { sendToBg } from "./messaging";
import { showToast } from "./toast";

let activePopoverEl: HTMLElement | null = null;

function closeActivePopover(): void {
  if (activePopoverEl) {
    activePopoverEl.remove();
    activePopoverEl = null;
  }
}

function injectPopoverStyles(): void {
  if (document.getElementById("tse-progress-popover-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-progress-popover-styles";
  style.textContent = `
    .tse-progress-popover {
      position: fixed;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 12px;
      padding: 12px 14px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.08);
      color: #f4f4f5;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 2147483647;
      min-width: 240px;
      max-width: 300px;
      animation: tseFadeIn 0.12s ease-out;
      user-select: none;
    }
    .tse-prog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .tse-prog-title {
      font-weight: 600;
      font-size: 13px;
      color: #fafafa;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tse-prog-close {
      background: none;
      border: none;
      color: #71717a;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      padding: 2px 5px;
      border-radius: 4px;
    }
    .tse-prog-close:hover {
      color: #f4f4f5;
      background: rgba(255, 255, 255, 0.1);
    }
    .tse-prog-input-wrap {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .tse-prog-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 7px;
      padding: 6px 10px;
      color: #ffffff;
      font-size: 13px;
      outline: none;
      transition: border-color 0.12s ease, box-shadow 0.12s ease;
      box-sizing: border-box;
    }
    .tse-prog-input:focus {
      border-color: #7c5cff;
      box-shadow: 0 0 0 2px rgba(124, 92, 255, 0.25);
    }
    .tse-prog-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .tse-prog-pill {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 5px;
      padding: 2.5px 7px;
      font-size: 11px;
      color: #d4d4d8;
      cursor: pointer;
      transition: background 0.1s ease, color 0.1s ease;
    }
    .tse-prog-pill:hover {
      background: rgba(124, 92, 255, 0.25);
      border-color: rgba(124, 92, 255, 0.5);
      color: #ffffff;
    }
    .tse-prog-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
      margin-top: 2px;
    }
    .tse-prog-btn {
      padding: 5px 12px;
      border-radius: 6px;
      border: none;
      font-size: 12px;
      cursor: pointer;
      font-weight: 500;
      transition: background 0.12s ease;
    }
    .tse-prog-btn.save {
      background: #7c5cff;
      color: #ffffff;
    }
    .tse-prog-btn.save:hover {
      background: #6a46f7;
    }
    .tse-prog-btn.clear {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .tse-prog-btn.clear:hover {
      background: rgba(239, 68, 68, 0.25);
    }
  `;
  document.head.appendChild(style);
}

/** Open quick progress input popover for a goal. */
export function openProgressPopover(
  goalId: string,
  anchor: HTMLElement | { x: number; y: number },
): void {
  closeActivePopover();
  injectPopoverStyles();

  const currentVal = getTaskProgressNotes()[goalId] ?? "";

  const pop = document.createElement("div");
  pop.className = "tse-progress-popover";

  // Header
  const header = document.createElement("div");
  header.className = "tse-prog-header";
  const title = document.createElement("span");
  title.className = "tse-prog-title";
  title.innerHTML = `<span>⏳</span> Progress / Remaining`;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tse-prog-close";
  closeBtn.textContent = "✕";
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeActivePopover();
  };
  header.append(title, closeBtn);

  // Input
  const inputWrap = document.createElement("div");
  inputWrap.className = "tse-prog-input-wrap";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tse-prog-input";
  input.placeholder = "e.g. 50% or 15m left";
  input.value = currentVal;
  inputWrap.appendChild(input);

  const save = (val: string) => {
    const trimmed = val.trim();
    closeActivePopover();
    optimisticProgressNote(goalId, trimmed || null);
    void sendToBg({
      type: "SET_TASK_PROGRESS_NOTE",
      goalId,
      note: trimmed || null,
    });
    showToast(trimmed ? `✓ Progress set: ${trimmed}` : "✓ Progress cleared");
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save(input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeActivePopover();
    }
  });

  // Quick preset pills
  const pillsWrap = document.createElement("div");
  pillsWrap.className = "tse-prog-pills";
  const presets = ["25%", "50%", "75%", "15m", "30m", "45m", "1h"];
  for (const p of presets) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "tse-prog-pill";
    pill.textContent = p;
    pill.onclick = (e) => {
      e.stopPropagation();
      input.value = p;
      input.focus();
    };
    pillsWrap.appendChild(pill);
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "tse-prog-actions";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "tse-prog-btn clear";
  clearBtn.textContent = "Clear";
  clearBtn.title = "Clear progress note";
  clearBtn.onclick = (e) => {
    e.stopPropagation();
    input.value = "";
    save("");
  };
  actions.appendChild(clearBtn);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "tse-prog-btn save";
  saveBtn.textContent = "Save";
  saveBtn.onclick = (e) => {
    e.stopPropagation();
    save(input.value);
  };
  actions.appendChild(saveBtn);

  pop.append(header, inputWrap, pillsWrap, actions);
  document.body.appendChild(pop);
  activePopoverEl = pop;

  // Positioning
  const popRect = pop.getBoundingClientRect();
  let top = 0;
  let left = 0;

  if ("getBoundingClientRect" in anchor) {
    const r = anchor.getBoundingClientRect();
    top = r.bottom + 6;
    left = Math.max(10, r.left);
  } else {
    top = anchor.y + 6;
    left = Math.max(10, anchor.x - 20);
  }

  if (top + popRect.height > window.innerHeight - 10) {
    top = Math.max(10, top - popRect.height - 24);
  }
  if (left + popRect.width > window.innerWidth - 10) {
    left = Math.max(10, window.innerWidth - popRect.width - 10);
  }

  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;

  // Focus input and select all text
  setTimeout(() => {
    input.focus();
    input.select();
  }, 40);

  // Dismiss on outside click
  const onDocClick = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) {
      closeActivePopover();
      document.removeEventListener("click", onDocClick, true);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", onDocClick, true);
  }, 50);
}

/** Initialize right-click gesture on task rows to open the quick progress input. */
export function initProgressShortcuts(): void {
  document.addEventListener(
    "contextmenu",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Ignore right-clicks inside our own modals and selection bar
      if (
        target.closest(
          "[id^='tse-'], [class*='tse-'], #tse-selection-bar, .tse-dash-overlay, .tse-modal-backdrop",
        )
      ) {
        return;
      }

      const wrapper = target.closest<HTMLElement>(".GoalRowWrapper");
      if (!wrapper) return;

      const goalId = goalIdFromWrapper(wrapper);
      if (!goalId) return;

      // Prevent native context menu and open our sleek progress popover
      e.preventDefault();
      e.stopPropagation();
      openProgressPopover(goalId, { x: e.clientX, y: e.clientY });
    },
    true,
  );
}
