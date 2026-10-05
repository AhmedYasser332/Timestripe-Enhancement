/**
 * Fast Day Scheduler (PRD §23–§26) — rebuilt to mirror Timestripe's native
 * Reschedule calendar (year + month navigation, W## week rows, Mon-start grid,
 * today / tomorrow / this week quick actions, Remove date row).
 *
 * Distribution presets for multi-select: One per day / One per week /
 * One per month / One per year / Assign same day / Clear all dates.
 * Universal Ctrl+Z undo is preserved.
 */

import { addDays, addMonths, addYears, formatShortDate, isoWeekNumber, weekStart } from "../shared/dates";
import type { TSGoal } from "../shared/types";
import { pushAction } from "./history";
import { sendToBg } from "./messaging";
import { showToast } from "./toast";
import { bindActivate } from "./activate";

let activeSchedulerModal: HTMLElement | null = null;

export function closeSchedulerModal(): void {
  if (activeSchedulerModal) {
    activeSchedulerModal.remove();
    activeSchedulerModal = null;
  }
}

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS_HEAD = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function todayStr(): string {
  const now = new Date();
  return toDateStr(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/**
 * Timestripe-native calendar panel: ‹ year › / ‹ month › headers, W## week
 * rows, Mon-start day grid, quick pills and a Remove-date row.
 * Every commit action (day, pill, remove) closes the popover itself.
 */
function buildCalendar(
  initialDate: string | null,
  onPick: (date: string) => void,
  onRemove: () => void,
): { el: HTMLElement; close: () => void } {
  const pop = document.createElement("div");
  pop.className = "tse-cal-pop";

  const close = (): void => {
    pop.remove();
    document.removeEventListener("pointerdown", dismissDoc, true);
  };
  const dismissDoc = (e: PointerEvent): void => {
    if (!pop.contains(e.target as Node)) close();
  };

  let viewYear: number;
  let viewMonth: number; // 0-based
  const selected = initialDate ?? null;
  if (selected) {
    const [y, m] = selected.split("-").map(Number);
    viewYear = y;
    viewMonth = m - 1;
  } else {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
  }
  const today = todayStr();

  const yearRow = document.createElement("div");
  yearRow.className = "tse-cal-navrow";
  const yearLabel = document.createElement("span");
  yearLabel.className = "tse-cal-navlabel";
  yearLabel.textContent = String(viewYear);

  const monthRow = document.createElement("div");
  monthRow.className = "tse-cal-navrow";
  const monthLabel = document.createElement("span");
  monthLabel.className = "tse-cal-navlabel";
  monthLabel.textContent = MONTHS_FULL[viewMonth];

  const makeNavBtn = (label: string, fn: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tse-cal-navbtn";
    b.textContent = label;
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    return b;
  };

  const renderGrid = (): void => {
    yearLabel.textContent = String(viewYear);
    monthLabel.textContent = MONTHS_FULL[viewMonth];

    grid.querySelectorAll(".tse-cal-weekrow, .tse-cal-headcell, .tse-cal-wk").forEach((el) => el.remove());

    for (const d of DAYS_HEAD) {
      const h = document.createElement("span");
      h.className = "tse-cal-headcell";
      h.textContent = d;
      grid.appendChild(h);
    }

    // First Monday on/before the 1st of the viewed month
    const first = new Date(Date.UTC(viewYear, viewMonth, 1));
    const dow = (first.getUTCDay() + 6) % 7; // Mon=0
    const start = new Date(first);
    start.setUTCDate(start.getUTCDate() - dow);

    for (let w = 0; w < 6; w++) {
      const weekRow = document.createElement("div");
      weekRow.className = "tse-cal-weekrow";

      const monday = new Date(start);
      monday.setUTCDate(start.getUTCDate() + w * 7);
      const wk = document.createElement("span");
      wk.className = "tse-cal-wk";
      wk.textContent = `W${isoWeekNumber(toDateStr(monday))}`;
      weekRow.appendChild(wk);

      for (let i = 0; i < 7; i++) {
        const day = new Date(monday);
        day.setUTCDate(monday.getUTCDate() + i);
        const ds = toDateStr(day);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "tse-cal-day";
        cell.textContent = String(day.getUTCDate());
        cell.dataset.date = ds;
        if (day.getUTCMonth() !== viewMonth) cell.classList.add("dimmed");
        if (ds === today) cell.classList.add("today");
        if (ds === selected) cell.classList.add("selected");
        cell.onclick = (e) => {
          e.stopPropagation();
          close();
          onPick(ds);
        };
        weekRow.appendChild(cell);
      }
      grid.appendChild(weekRow);
    }
  };

  const yearPrev = makeNavBtn("‹", () => {
    viewYear--;
    renderGrid();
  });
  const yearNext = makeNavBtn("›", () => {
    viewYear++;
    renderGrid();
  });
  yearRow.append(yearPrev, yearLabel, yearNext);

  const monthPrev = makeNavBtn("‹", () => {
    viewMonth--;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    }
    renderGrid();
  });
  const monthNext = makeNavBtn("›", () => {
    viewMonth++;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear++;
    }
    renderGrid();
  });
  monthRow.append(monthPrev, monthLabel, monthNext);

  // Grid header spacer over the W column
  const headSpacer = document.createElement("span");
  headSpacer.className = "tse-cal-wk";
  headSpacer.textContent = "WEEKS";

  const grid = document.createElement("div");
  grid.className = "tse-cal-grid";
  grid.appendChild(headSpacer);

  const quickRow = document.createElement("div");
  quickRow.className = "tse-cal-quickrow";
  const makePill = (label: string, primary: boolean, date: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = primary ? "tse-cal-pill primary" : "tse-cal-pill";
    b.textContent = label;
    b.onclick = (e) => {
      e.stopPropagation();
      close();
      onPick(date);
    };
    return b;
  };
  quickRow.append(
    makePill("today", true, today),
    makePill("tomorrow", false, addDays(today, 1)),
    makePill("this week", false, addDays(weekStart(today), 7)),
  );

  const removeRow = document.createElement("button");
  removeRow.type = "button";
  removeRow.className = "tse-cal-remove";
  removeRow.textContent = "Remove date";
  removeRow.onclick = (e) => {
    e.stopPropagation();
    close();
    onRemove();
  };

  renderGrid();
  pop.append(yearRow, monthRow, grid, quickRow, removeRow);
  return { el: pop, close };
}

/** Position + mount a popover near an anchor element with viewport clamping. */
function mountPopover(anchor: HTMLElement, pop: HTMLElement, close: () => void): void {
  pop.style.visibility = "hidden";
  const host = anchor.closest(".tse-modal-backdrop") ?? document.body;
  host.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let x = r.right + 10;
  let y = r.top;
  if (x + pw > window.innerWidth - 8) x = r.left - pw - 10;
  if (x < 8) x = Math.max(8, (window.innerWidth - pw) / 2);
  if (y + ph > window.innerHeight - 8) y = window.innerHeight - ph - 8;
  if (y < 8) y = 8;
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
  pop.style.visibility = "visible";

  const dismiss = (e: PointerEvent) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
}

function injectSchedulerStyles(): void {
  if (document.getElementById("tse-scheduler-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-scheduler-styles";
  style.textContent = `
    .tse-sched-modal-box {
      width: 560px;
      max-width: calc(100vw - 32px);
      max-height: 85vh;
      background: #1c1c1e;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      padding: 22px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
      color: #f4f4f5;
      font-family: inherit;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow: hidden;
    }
    .tse-sched-quick-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      background: rgba(255, 255, 255, 0.03);
      padding: 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .tse-sched-anchor-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      background: #27272a;
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.16);
      cursor: pointer;
      font-family: inherit;
      transition: all 0.1s ease;
    }
    .tse-sched-anchor-btn:hover {
      background: #2f2f33;
      border-color: rgba(255, 255, 255, 0.3);
    }
    .tse-sched-anchor-btn .cal-ico {
      width: 13px;
      height: 13px;
      border: 1.5px solid #a1a1aa;
      border-radius: 3px;
      position: relative;
      display: inline-block;
    }
    .tse-sched-anchor-btn .cal-ico::before {
      content: "";
      position: absolute;
      top: -4px; left: 2px; right: 2px;
      height: 2px;
      background: #a1a1aa;
    }
    .tse-sched-quick-btn {
      padding: 5px 10px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.08);
      color: #e4e4e7;
      border: 1px solid rgba(255, 255, 255, 0.1);
      cursor: pointer;
      transition: all 0.1s ease;
      font-family: inherit;
    }
    .tse-sched-quick-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }
    .tse-sched-table-wrapper {
      flex: 1;
      overflow-y: auto;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.2);
    }
    .tse-sched-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .tse-sched-table th {
      text-align: start;
      padding: 8px 12px;
      font-size: 11.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a1a1aa;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      position: sticky;
      top: 0;
      background: #1c1c1e;
      z-index: 2;
    }
    .tse-sched-table td {
      padding: 7px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      vertical-align: middle;
    }
    .tse-sched-row:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .tse-sched-date-cell {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tse-sched-date-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 118px;
      padding: 5px 10px;
      border-radius: 7px;
      font-size: 12.5px;
      font-weight: 500;
      background: #27272a;
      color: #f4f4f5;
      border: 1px solid rgba(255, 255, 255, 0.14);
      cursor: pointer;
      font-family: inherit;
      transition: all 0.1s ease;
    }
    .tse-sched-date-btn:hover {
      background: #2f2f33;
      border-color: rgba(255, 255, 255, 0.3);
    }
    .tse-sched-date-btn.empty {
      color: #71717a;
    }
    .tse-sched-clear-btn {
      background: none;
      border: none;
      color: #71717a;
      font-size: 14px;
      cursor: pointer;
      padding: 2px 5px;
      border-radius: 4px;
    }
    .tse-sched-clear-btn:hover {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.12);
    }

    /* ===== Timestripe-native calendar popover ===== */
    .tse-cal-pop {
      position: fixed;
      z-index: 2147483647;
      width: 322px;
      background: #1c1c1e;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 14px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75);
      padding: 6px 10px 2px;
      color: #f4f4f5;
      font-family: inherit;
      user-select: none;
      animation: tseCalIn 0.12s ease-out;
    }
    @keyframes tseCalIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .tse-cal-navrow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 6px;
    }
    .tse-cal-navlabel {
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
      text-align: center;
      flex: 1;
    }
    .tse-cal-navbtn {
      background: transparent;
      border: none;
      color: #a1a1aa;
      font-size: 17px;
      width: 28px;
      height: 28px;
      border-radius: 7px;
      cursor: pointer;
      line-height: 1;
      transition: all 0.1s ease;
    }
    .tse-cal-navbtn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.08);
    }
    .tse-cal-grid {
      display: grid;
      grid-template-columns: 52px repeat(7, 1fr);
      row-gap: 2px;
      padding: 2px 0 8px;
    }
    .tse-cal-wk {
      font-size: 10.5px;
      font-weight: 600;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      align-self: center;
      padding-inline-end: 6px;
      text-align: end;
    }
    .tse-cal-headcell {
      font-size: 11px;
      font-weight: 600;
      color: #a1a1aa;
      text-align: center;
      padding: 5px 0;
      text-transform: uppercase;
    }
    .tse-cal-weekrow {
      display: contents;
    }
    .tse-cal-day {
      width: 34px;
      height: 34px;
      justify-self: center;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-radius: 50%;
      color: #e4e4e7;
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.1s ease;
    }
    .tse-cal-day:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .tse-cal-day.dimmed {
      color: #52525b;
    }
    .tse-cal-day.today {
      color: #2f7cf6;
      font-weight: 700;
      box-shadow: inset 0 0 0 1.5px #2f7cf6;
    }
    .tse-cal-day.selected {
      background: #2f7cf6;
      color: #ffffff;
      font-weight: 600;
    }
    .tse-cal-quickrow {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 6px 12px;
    }
    .tse-cal-pill {
      padding: 7px 14px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: #d4d4d8;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.1s ease;
    }
    .tse-cal-pill:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
    }
    .tse-cal-pill.primary {
      background: #2f7cf6;
      color: #ffffff;
      font-weight: 600;
    }
    .tse-cal-pill.primary:hover {
      background: #2a6fd9;
      color: #ffffff;
    }
    .tse-cal-remove {
      width: calc(100% + 20px);
      margin: 0 -10px;
      padding: 13px 16px;
      background: transparent;
      border: none;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      color: #f4f4f5;
      font-size: 14px;
      font-weight: 500;
      text-align: start;
      cursor: pointer;
      font-family: inherit;
      border-radius: 0 0 14px 14px;
      transition: background 0.1s ease;
    }
    .tse-cal-remove:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  `;
  document.head.appendChild(style);
}

export async function openSchedulerModal(selectedGoalIds: string[]): Promise<void> {
  if (selectedGoalIds.length === 0) return;
  closeSchedulerModal();
  injectSchedulerStyles();

  const backdrop = document.createElement("div");
  backdrop.className = "tse-modal-backdrop";
  activeSchedulerModal = backdrop;

  const box = document.createElement("div");
  box.className = "tse-sched-modal-box";

  // Header
  const header = document.createElement("div");
  header.className = "tse-modal-title";
  const titleText = document.createElement("span");
  titleText.textContent = `Fast Day Scheduler (${selectedGoalIds.length} tasks)`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "tse-modal-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.onclick = closeSchedulerModal;
  header.append(titleText, closeBtn);

  // Loading state
  const loading = document.createElement("div");
  loading.style.padding = "20px";
  loading.style.textAlign = "center";
  loading.style.color = "#a1a1aa";
  loading.textContent = "Loading tasks details…";
  box.append(header, loading);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  // Fetch details for all selected goals
  const goalsMap = new Map<string, TSGoal>();
  for (const id of selectedGoalIds) {
    const res = await sendToBg<TSGoal>({ type: "GET_GOAL_DETAILS", goalId: id });
    if (res?.ok && res.data) {
      goalsMap.set(id, res.data);
    }
  }

  loading.remove();

  // State mapping goalId -> targetDate
  const dateState = new Map<string, string | null>();
  const originalDates = new Map<string, string | null>();
  for (const [id, goal] of goalsMap.entries()) {
    dateState.set(id, goal.date);
    originalDates.set(id, goal.date);
  }

  const anchor = todayStr();

  // ===== Quick Action Bar =====
  const quickBar = document.createElement("div");
  quickBar.className = "tse-sched-quick-bar";

  const anchorBtn = document.createElement("button");
  anchorBtn.type = "button";
  anchorBtn.className = "tse-sched-anchor-btn";
  const syncAnchorLabel = (): void => {
    anchorBtn.innerHTML = `<span class="cal-ico"></span><span>${formatShortDate(anchorDate)}</span>`;
  };
  let anchorDate = anchor;
  syncAnchorLabel();
  bindActivate(anchorBtn, () => {
    const cal = buildCalendar(
      anchorDate,
      (d) => {
        anchorDate = d;
        syncAnchorLabel();
      },
      () => {
        /* the anchor always keeps a date */
      },
    );
    mountPopover(anchorBtn, cal.el, cal.close);
  });

  const makePreset = (label: string, title: string, fn: (i: number, base: string) => string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tse-sched-quick-btn";
    b.textContent = label;
    b.title = title;
    bindActivate(b, () => {
      let i = 0;
      for (const id of goalsMap.keys()) {
        const assigned = fn(i, anchorDate);
        dateState.set(id, assigned);
        const btn = rowDateButtons.get(id);
        if (btn) syncRowLabel(btn, assigned);
        i++;
      }
    });
    return b;
  };

  const clearAllBtn = document.createElement("button");
  clearAllBtn.type = "button";
  clearAllBtn.className = "tse-sched-quick-btn";
  clearAllBtn.textContent = "Clear all dates";
  bindActivate(clearAllBtn, () => {
    for (const id of goalsMap.keys()) {
      dateState.set(id, null);
      const btn = rowDateButtons.get(id);
      if (btn) syncRowLabel(btn, null);
    }
  });

  quickBar.append(
    anchorBtn,
    makePreset("One per day", "Task i → anchor + i days", (idx, base) => addDays(base, idx)),
    makePreset("One per week", "Task i → anchor + i weeks", (idx, base) => addDays(base, idx * 7)),
    makePreset("One per month", "Task i → anchor + i months (day clamped)", (idx, base) => addMonths(base, idx)),
    makePreset("One per year", "Task i → anchor + i years", (idx, base) => addYears(base, idx)),
    makePreset("Assign same day", "Assign all tasks to the anchor date", (_idx, base) => base),
    clearAllBtn,
  );

  // ===== Table =====
  const tableWrapper = document.createElement("div");
  tableWrapper.className = "tse-sched-table-wrapper";
  const table = document.createElement("table");
  table.className = "tse-sched-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th style="width: 58%">Task</th>
        <th style="width: 42%">Assigned Day</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody")!;
  const rowDateButtons = new Map<string, HTMLButtonElement>();

  const syncRowLabel = (btn: HTMLButtonElement, date: string | null): void => {
    btn.textContent = date ? formatShortDate(date) : "Pick a date…";
    btn.classList.toggle("empty", !date);
  };

  for (const [id, goal] of goalsMap.entries()) {
    const tr = document.createElement("tr");
    tr.className = "tse-sched-row";

    const tdName = document.createElement("td");
    tdName.textContent = goal.name || "(Unnamed task)";
    tdName.dir = "auto";

    const tdDate = document.createElement("td");
    const cell = document.createElement("div");
    cell.className = "tse-sched-date-cell";

    const dateBtn = document.createElement("button");
    dateBtn.type = "button";
    dateBtn.className = "tse-sched-date-btn";
    syncRowLabel(dateBtn, dateState.get(id) ?? null);
    bindActivate(dateBtn, () => {
      const cal = buildCalendar(
        dateState.get(id) ?? null,
        (d) => {
          dateState.set(id, d);
          syncRowLabel(dateBtn, d);
        },
        () => {
          dateState.set(id, null);
          syncRowLabel(dateBtn, null);
        },
      );
      mountPopover(dateBtn, cal.el, cal.close);
    });

    const clearRowBtn = document.createElement("button");
    clearRowBtn.type = "button";
    clearRowBtn.className = "tse-sched-clear-btn";
    clearRowBtn.textContent = "✕";
    clearRowBtn.title = "Clear date";
    clearRowBtn.onclick = () => {
      dateState.set(id, null);
      syncRowLabel(dateBtn, null);
    };

    cell.append(dateBtn, clearRowBtn);
    tdDate.appendChild(cell);

    tr.append(tdName, tdDate);
    tbody.appendChild(tr);
    rowDateButtons.set(id, dateBtn);
  }

  // ===== Actions =====
  const actions = document.createElement("div");
  actions.className = "tse-modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "tse-btn tse-btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = closeSchedulerModal;

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "tse-btn tse-btn-primary";
  saveBtn.textContent = "Apply Schedule";

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    const updates: Array<{ goalId: string; date: string | null }> = [];
    for (const [id, date] of dateState.entries()) {
      updates.push({ goalId: id, date });
    }

    try {
      const res = await sendToBg<{ updated: number }>({
        type: "SCHEDULE_GOALS",
        updates,
      });

      if (res?.ok) {
        showToast(`Scheduled ${res.data.updated} goals`);
        closeSchedulerModal();

        // Push to History Stack for Ctrl+Z Undo
        pushAction({
          id: crypto.randomUUID(),
          description: `Fast Schedule: ${updates.length} tasks`,
          undo: async () => {
            const revertUpdates = Array.from(originalDates.entries()).map(([goalId, date]) => ({
              goalId,
              date,
            }));
            await sendToBg({ type: "SCHEDULE_GOALS", updates: revertUpdates });
            showToast("Undid Fast Schedule (dates restored)");
          },
          redo: async () => {
            await sendToBg({ type: "SCHEDULE_GOALS", updates });
            showToast("Redid Fast Schedule");
          },
        });
      } else {
        showToast(`Scheduling failed: ${res?.error ?? "Unknown error"}`);
        saveBtn.disabled = false;
        saveBtn.textContent = "Apply Schedule";
      }
    } catch (e) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`);
      saveBtn.disabled = false;
      saveBtn.textContent = "Apply Schedule";
    }
  };

  actions.append(cancelBtn, saveBtn);

  tableWrapper.appendChild(table);
  box.append(quickBar, tableWrapper, actions);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeSchedulerModal();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      closeSchedulerModal();
      document.removeEventListener("keydown", onKey, true);
    }
  };
  document.addEventListener("keydown", onKey, true);
}
