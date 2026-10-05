/**
 * Smart Duplicate Dialog (PRD §19–§22, §49, §50).
 * Supports:
 * - Scope: Main goal only vs Main goal with all subgoals (recursive tree).
 * - Field toggles: Project, Colors, Notes, Horizon, Dates, Completion state.
 * - Relative date offset calculation when a target anchor date is selected.
 * - Idempotency guard preventing double submission.
 */

import { sendToBg } from "./messaging";
import { showToast } from "./toast";
import { pushAction } from "./history";
import type { DuplicateOptions, SmartDuplicateResult } from "../shared/messages";
import type { TSGoal } from "../shared/types";

let activeModal: HTMLElement | null = null;

export function closeDuplicateModal(): void {
  if (activeModal) {
    activeModal.remove();
    activeModal = null;
  }
}

function injectModalStyles(): void {
  if (document.getElementById("tse-duplicate-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-duplicate-styles";
  style.textContent = `
    .tse-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483647;
      animation: tseFadeIn 0.15s ease-out;
    }
    .tse-modal-box {
      width: 440px;
      max-width: calc(100vw - 32px);
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 14px;
      padding: 22px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
      color: #f4f4f5;
      font-family: inherit;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .tse-modal-title {
      font-size: 17px;
      font-weight: 600;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .tse-modal-close-btn {
      background: none;
      border: none;
      color: #a1a1aa;
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
      border-radius: 4px;
    }
    .tse-modal-close-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.08);
    }
    .tse-section-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a1a1aa;
      margin-bottom: 6px;
    }
    .tse-radio-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: rgba(255, 255, 255, 0.03);
      padding: 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .tse-radio-item, .tse-check-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13.5px;
      cursor: pointer;
      user-select: none;
    }
    .tse-checkbox-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      background: rgba(255, 255, 255, 0.03);
      padding: 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .tse-date-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tse-date-input {
      background: #27272a;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      padding: 7px 10px;
      color: #f4f4f5;
      font-size: 13px;
      font-family: inherit;
    }
    .tse-date-hint {
      font-size: 11.5px;
      color: #71717a;
      line-height: 1.4;
    }
    .tse-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 6px;
    }
    .tse-btn {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.12s ease;
    }
    .tse-btn-cancel {
      background: rgba(255, 255, 255, 0.08);
      color: #e4e4e7;
    }
    .tse-btn-cancel:hover {
      background: rgba(255, 255, 255, 0.14);
    }
    .tse-btn-primary {
      background: #7c5cff;
      color: #ffffff;
    }
    .tse-btn-primary:hover:not(:disabled) {
      background: #6a46f7;
    }
    .tse-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
}

export async function openDuplicateModal(goalId: string, initialGoalName = "Goal"): Promise<void> {
  closeDuplicateModal();
  injectModalStyles();

  // Fetch goal details to check date
  let originalDate: string | null = null;
  const detailsRes = await sendToBg<TSGoal>({ type: "GET_GOAL_DETAILS", goalId });
  if (detailsRes?.ok && detailsRes.data) {
    originalDate = detailsRes.data.date;
    if (detailsRes.data.name) initialGoalName = detailsRes.data.name;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "tse-modal-backdrop";
  activeModal = backdrop;

  const box = document.createElement("div");
  box.className = "tse-modal-box";

  // Header
  const header = document.createElement("div");
  header.className = "tse-modal-title";
  const titleText = document.createElement("span");
  titleText.textContent = `Smart Duplicate: ${initialGoalName.slice(0, 24)}${initialGoalName.length > 24 ? "…" : ""}`;
  titleText.dir = "auto";
  const closeBtn = document.createElement("button");
  closeBtn.className = "tse-modal-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.onclick = closeDuplicateModal;
  header.append(titleText, closeBtn);

  // Scope Section (PRD §20)
  const scopeSection = document.createElement("div");
  const scopeLabel = document.createElement("div");
  scopeLabel.className = "tse-section-label";
  scopeLabel.textContent = "Scope";
  const scopeGroup = document.createElement("div");
  scopeGroup.className = "tse-radio-group";

  const radioTree = document.createElement("input");
  radioTree.type = "radio";
  radioTree.name = "tse-dup-scope";
  radioTree.value = "tree";
  radioTree.checked = true;

  const labelTree = document.createElement("label");
  labelTree.className = "tse-radio-item";
  labelTree.append(radioTree, document.createTextNode("Main goal with all subgoals (recursive tree)"));

  const radioMain = document.createElement("input");
  radioMain.type = "radio";
  radioMain.name = "tse-dup-scope";
  radioMain.value = "main";

  const labelMain = document.createElement("label");
  labelMain.className = "tse-radio-item";
  labelMain.append(radioMain, document.createTextNode("Main goal only"));

  scopeGroup.append(labelTree, labelMain);
  scopeSection.append(scopeLabel, scopeGroup);

  // Copy Options (PRD §21)
  const copySection = document.createElement("div");
  const copyLabel = document.createElement("div");
  copyLabel.className = "tse-section-label";
  copyLabel.textContent = "Copy Properties";
  const checkGrid = document.createElement("div");
  checkGrid.className = "tse-checkbox-grid";

  const makeCheck = (label: string, checked: boolean) => {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    const lbl = document.createElement("label");
    lbl.className = "tse-check-item";
    lbl.append(input, document.createTextNode(label));
    return { input, labelEl: lbl };
  };

  const chkProject = makeCheck("Project & Colors", true);
  const chkNotes = makeCheck("Notes", true);
  const chkHorizon = makeCheck("Horizon", true);
  const chkDates = makeCheck("Dates", true);
  const chkCompletion = makeCheck("Completion state", false);

  checkGrid.append(
    chkProject.labelEl,
    chkNotes.labelEl,
    chkHorizon.labelEl,
    chkDates.labelEl,
    chkCompletion.labelEl,
  );
  copySection.append(copyLabel, checkGrid);

  // Scheduling Semantics & Date Offset (PRD §22)
  const dateSection = document.createElement("div");
  dateSection.className = "tse-date-group";
  const dateLabel = document.createElement("div");
  dateLabel.className = "tse-section-label";
  dateLabel.textContent = "Target Anchor Date (Optional)";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "tse-date-input";
  if (originalDate) {
    dateInput.value = originalDate;
  }
  const dateHint = document.createElement("div");
  dateHint.className = "tse-date-hint";
  dateHint.textContent = originalDate
    ? `Original starts on ${originalDate}. Picking a new date will shift subgoals preserving exact relative offsets.`
    : "No date set on original. Set a target date to schedule this copy.";

  dateSection.append(dateLabel, dateInput, dateHint);

  // Actions
  const actions = document.createElement("div");
  actions.className = "tse-modal-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "tse-btn tse-btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = closeDuplicateModal;

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "tse-btn tse-btn-primary";
  submitBtn.textContent = "Duplicate";

  // Prevent double click (PRD §50)
  let submitting = false;
  submitBtn.onclick = async () => {
    if (submitting) return;
    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Duplicating…";

    const options: DuplicateOptions = {
      scope: radioTree.checked ? "tree" : "main",
      copyProject: chkProject.input.checked,
      copyColors: chkProject.input.checked,
      copyNotes: chkNotes.input.checked,
      copyHorizon: chkHorizon.input.checked,
      copyDates: chkDates.input.checked,
      copyCompletion: chkCompletion.input.checked,
      targetAnchorDate: dateInput.value || null,
    };

    try {
      const res = await sendToBg<SmartDuplicateResult>({
        type: "SMART_DUPLICATE",
        goalId,
        options,
      });

      if (res?.ok) {
        const createdRootId = res.data.newRootId;
        showToast(`Duplicated ${res.data.totalCreated} goal${res.data.totalCreated > 1 ? "s" : ""}`);
        closeDuplicateModal();

        pushAction({
          id: crypto.randomUUID(),
          description: `Duplicate: ${initialGoalName}`,
          undo: async () => {
            await sendToBg({ type: "BULK_DELETE_GOALS", goalIds: [createdRootId] });
            showToast(`Undid duplicate of ${initialGoalName}`);
          },
          redo: async () => {
            const reRes = await sendToBg<SmartDuplicateResult>({
              type: "SMART_DUPLICATE",
              goalId,
              options,
            });
            if (reRes?.ok) {
              showToast(`Redid duplicate of ${initialGoalName}`);
            }
          },
        });
      } else {
        showToast(`Duplicate failed: ${res?.error ?? "Unknown error"}`);
        submitBtn.disabled = false;
        submitBtn.textContent = "Duplicate";
        submitting = false;
      }
    } catch (e) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`);
      submitBtn.disabled = false;
      submitBtn.textContent = "Duplicate";
      submitting = false;
    }
  };

  actions.append(cancelBtn, submitBtn);

  box.append(header, scopeSection, copySection, dateSection, actions);
  backdrop.append(box);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeDuplicateModal();
  });

  document.body.appendChild(backdrop);
}
