/**
 * Reusable Templates System Modal (PRD §27–§30).
 * Supports:
 * - "Save Selection as Template" capturing hierarchy, relative offsets, projects & colors.
 * - "Apply Template" with target anchor date, creating the whole tree level-by-level.
 * - Delete template.
 * - Universal Ctrl+Z Undo for applied templates (deleting root cascades in Timestripe).
 */

import { computeDayOffset } from "../shared/dates";
import type { GoalTemplate, TemplateNode, TSGoal } from "../shared/types";
import { pushAction } from "./history";
import { sendToBg } from "./messaging";
import { getSelectedIds, getSelectedRoots } from "./selection-state";
import { getTaskColorOverrides, getViewState } from "./state";
import { showToast } from "./toast";

let activeTemplatesModal: HTMLElement | null = null;

export function closeTemplatesModal(): void {
  if (activeTemplatesModal) {
    activeTemplatesModal.remove();
    activeTemplatesModal = null;
  }
}

function injectTemplateStyles(): void {
  if (document.getElementById("tse-template-styles")) return;
  const style = document.createElement("style");
  style.id = "tse-template-styles";
  style.textContent = `
    .tse-tpl-modal-box {
      width: 500px;
      max-width: calc(100vw - 32px);
      max-height: 85vh;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.14);
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
    .tse-tpl-tabs {
      display: flex;
      gap: 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 8px;
    }
    .tse-tpl-tab {
      padding: 6px 14px;
      border-radius: 6px;
      border: none;
      background: none;
      color: #a1a1aa;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .tse-tpl-tab.active {
      background: rgba(255, 255, 255, 0.09);
      color: #ffffff;
      font-weight: 600;
    }
    .tse-tpl-tab:hover:not(.active) {
      color: #e4e4e7;
    }
    .tse-tpl-list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 360px;
    }
    .tse-tpl-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: border-color 0.12s ease;
    }
    .tse-tpl-card:hover {
      border-color: rgba(255, 255, 255, 0.2);
    }
    .tse-tpl-card.selected {
      border-color: #7c5cff;
      background: rgba(124, 92, 255, 0.06);
    }
    .tse-tpl-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .tse-tpl-card-title {
      font-weight: 600;
      font-size: 14px;
      color: #f4f4f5;
    }
    .tse-tpl-card-meta {
      font-size: 11.5px;
      color: #a1a1aa;
    }
    .tse-tpl-del-btn {
      background: none;
      border: none;
      color: #71717a;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
    }
    .tse-tpl-del-btn:hover {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.12);
    }
    .tse-tpl-form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tse-tpl-input {
      background: #27272a;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      padding: 7px 10px;
      color: #f4f4f5;
      font-size: 13px;
      font-family: inherit;
    }
  `;
  document.head.appendChild(style);
}

export async function openTemplatesModal(initialTab: "apply" | "save" = "apply"): Promise<void> {
  closeTemplatesModal();
  injectTemplateStyles();

  const backdrop = document.createElement("div");
  backdrop.className = "tse-modal-backdrop";
  activeTemplatesModal = backdrop;

  const box = document.createElement("div");
  box.className = "tse-tpl-modal-box";

  // Header
  const header = document.createElement("div");
  header.className = "tse-modal-title";
  const titleText = document.createElement("span");
  titleText.textContent = "Goal Templates";
  const closeBtn = document.createElement("button");
  closeBtn.className = "tse-modal-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.onclick = closeTemplatesModal;
  header.append(titleText, closeBtn);

  // Tabs
  const tabsNav = document.createElement("div");
  tabsNav.className = "tse-tpl-tabs";
  const tabApply = document.createElement("button");
  tabApply.type = "button";
  tabApply.className = initialTab === "apply" ? "tse-tpl-tab active" : "tse-tpl-tab";
  tabApply.textContent = "Saved Templates";

  const tabSave = document.createElement("button");
  tabSave.type = "button";
  tabSave.className = initialTab === "save" ? "tse-tpl-tab active" : "tse-tpl-tab";
  tabSave.textContent = "Save as Template";

  tabsNav.append(tabApply, tabSave);

  const contentContainer = document.createElement("div");
  contentContainer.style.display = "flex";
  contentContainer.style.flexDirection = "column";
  contentContainer.style.gap = "14px";
  contentContainer.style.flex = "1";
  contentContainer.style.overflow = "hidden";

  box.append(header, tabsNav, contentContainer);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  // Render Apply View
  const renderApplyView = async () => {
    contentContainer.innerHTML = '<div style="color:#a1a1aa;padding:12px;text-align:center">Loading templates…</div>';
    const res = await sendToBg<GoalTemplate[]>({ type: "LIST_TEMPLATES" });
    const templates = res?.ok ? res.data : [];

    contentContainer.innerHTML = "";

    if (templates.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "24px 12px";
      empty.style.textAlign = "center";
      empty.style.color = "#a1a1aa";
      empty.style.fontSize = "13px";
      empty.textContent = "No templates saved yet. Select tasks on your board and click 'Save as Template'.";
      contentContainer.appendChild(empty);
      return;
    }

    let selectedTemplateId = templates[0].id;

    const list = document.createElement("div");
    list.className = "tse-tpl-list";

    for (const tpl of templates) {
      const card = document.createElement("div");
      card.className = tpl.id === selectedTemplateId ? "tse-tpl-card selected" : "tse-tpl-card";
      card.onclick = () => {
        selectedTemplateId = tpl.id;
        list.querySelectorAll(".tse-tpl-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
      };

      const topRow = document.createElement("div");
      topRow.className = "tse-tpl-card-header";
      const cardTitle = document.createElement("span");
      cardTitle.className = "tse-tpl-card-title";
      cardTitle.textContent = tpl.name;
      cardTitle.dir = "auto";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "tse-tpl-del-btn";
      delBtn.textContent = "✕";
      delBtn.title = "Delete template";
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        await sendToBg({ type: "DELETE_TEMPLATE", templateId: tpl.id });
        showToast(`Deleted template: ${tpl.name}`);
        void renderApplyView();
      };

      topRow.append(cardTitle, delBtn);

      const meta = document.createElement("div");
      meta.className = "tse-tpl-card-meta";
      meta.textContent = `${tpl.nodes.length} tasks • Root: "${tpl.rootGoalName}"`;
      meta.dir = "auto";

      card.append(topRow, meta);
      list.appendChild(card);
    }

    // Anchor Date Picker
    const dateRow = document.createElement("div");
    dateRow.className = "tse-tpl-form-group";
    const dateLabel = document.createElement("label");
    dateLabel.textContent = "Anchor Date (Target Start Date):";
    dateLabel.style.fontSize = "12.5px";
    dateLabel.style.color = "#a1a1aa";
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.className = "tse-tpl-input";
    dateInput.value = new Date().toISOString().split("T")[0];
    dateRow.append(dateLabel, dateInput);

    // Actions
    const actions = document.createElement("div");
    actions.className = "tse-modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "tse-btn tse-btn-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = closeTemplatesModal;

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "tse-btn tse-btn-primary";
    applyBtn.textContent = "Apply Template";

    applyBtn.onclick = async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = "Applying…";

      try {
        const targetAnchorDate = dateInput.value || new Date().toISOString().split("T")[0];
        const resApply = await sendToBg<import("../shared/messages").SmartDuplicateResult>({
          type: "APPLY_TEMPLATE",
          templateId: selectedTemplateId,
          targetAnchorDate,
        });

        if (resApply?.ok) {
          const createdRootIds = resApply.data.newRootIds ?? [resApply.data.newRootId];
          const totalCreated = resApply.data.totalCreated;
          showToast(`Applied template (${totalCreated} goals created)`);
          closeTemplatesModal();

          // Push action for Ctrl+Z Undo
          pushAction({
            id: crypto.randomUUID(),
            description: "Apply Template",
            undo: async () => {
              await sendToBg({ type: "BULK_DELETE_GOALS", goalIds: createdRootIds });
              showToast("Undid Apply Template (removed created tasks)");
            },
            redo: async () => {
              await sendToBg({ type: "APPLY_TEMPLATE", templateId: selectedTemplateId, targetAnchorDate });
              showToast("Redid Apply Template");
            },
          });
        } else {
          showToast(`Apply failed: ${resApply?.error ?? "Unknown error"}`);
          applyBtn.disabled = false;
          applyBtn.textContent = "Apply Template";
        }
      } catch (e) {
        showToast(`Error: ${e instanceof Error ? e.message : String(e)}`);
        applyBtn.disabled = false;
        applyBtn.textContent = "Apply Template";
      }
    };

    actions.append(cancelBtn, applyBtn);
    contentContainer.append(list, dateRow, actions);
  };

  // Render Save View
  const renderSaveView = async () => {
    const selectedIds = getSelectedIds();
    contentContainer.innerHTML = "";

    if (selectedIds.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "24px 12px";
      empty.style.textAlign = "center";
      empty.style.color = "#a1a1aa";
      empty.textContent = "No tasks currently selected. Select tasks on your board first to save them as a template.";
      contentContainer.appendChild(empty);
      return;
    }

    const roots = getSelectedRoots();
    const primaryRootId = roots[0] ?? selectedIds[0];

    // Fetch primary root details
    let defaultName = "My Template";
    const detailsRes = await sendToBg<TSGoal>({ type: "GET_GOAL_DETAILS", goalId: primaryRootId });
    if (detailsRes?.ok && detailsRes.data.name) {
      defaultName = detailsRes.data.name;
    }

    const form = document.createElement("div");
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.gap = "12px";

    const nameGroup = document.createElement("div");
    nameGroup.className = "tse-tpl-form-group";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Template Name:";
    nameLabel.style.fontSize = "12.5px";
    nameLabel.style.color = "#a1a1aa";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "tse-tpl-input";
    nameInput.value = defaultName;
    nameGroup.append(nameLabel, nameInput);

    const descGroup = document.createElement("div");
    descGroup.className = "tse-tpl-form-group";
    const descLabel = document.createElement("label");
    descLabel.textContent = "Description (Optional):";
    descLabel.style.fontSize = "12.5px";
    descLabel.style.color = "#a1a1aa";
    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.className = "tse-tpl-input";
    descInput.placeholder = "e.g. Monthly study sprint with weekly reviews";
    descGroup.append(descLabel, descInput);

    const info = document.createElement("div");
    info.style.fontSize = "12px";
    info.style.color = "#a1a1aa";
    info.textContent = `Capturing ${selectedIds.length} tasks and preserving tree relationships, relative date offsets, project links, and color overrides.`;

    const actions = document.createElement("div");
    actions.className = "tse-modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "tse-btn tse-btn-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = closeTemplatesModal;

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "tse-btn tse-btn-primary";
    saveBtn.textContent = "Save Template";

    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";

      // 1. Fetch details of all selected goals
      const goalsMap = new Map<string, TSGoal>();
      for (const id of selectedIds) {
        const r = await sendToBg<TSGoal>({ type: "GET_GOAL_DETAILS", goalId: id });
        if (r?.ok && r.data) goalsMap.set(id, r.data);
      }

      const rootGoal = goalsMap.get(primaryRootId);
      const rootAnchorDate = rootGoal?.date ?? new Date().toISOString().split("T")[0];

      const assignments = getViewState().assignments;
      const overrides = getTaskColorOverrides();

      // 2. Build template nodes
      const nodes: TemplateNode[] = [];
      for (const [id, goal] of goalsMap.entries()) {
        const offset = goal.date ? computeDayOffset(rootAnchorDate, goal.date) : null;
        const parentId = goal.parent_id && goalsMap.has(goal.parent_id) ? goal.parent_id : null;

        nodes.push({
          id,
          parentId,
          name: goal.name,
          description: goal.description ?? "",
          horizon: goal.horizon,
          dayOffset: offset,
          projectId: assignments[id]?.source === "explicit" ? assignments[id].projectId : null,
          colorOverride: overrides[id] ?? null,
        });
      }

      const template: GoalTemplate = {
        id: crypto.randomUUID(),
        name: nameInput.value.trim() || defaultName,
        description: descInput.value.trim() || undefined,
        createdAt: new Date().toISOString(),
        rootGoalName: rootGoal?.name || defaultName,
        nodes,
      };

      await sendToBg({ type: "SAVE_TEMPLATE", template });
      showToast(`Saved template: "${template.name}"`);

      // Switch to Apply tab
      tabApply.classList.add("active");
      tabSave.classList.remove("active");
      void renderApplyView();
    };

    actions.append(cancelBtn, saveBtn);
    form.append(nameGroup, descGroup, info, actions);
    contentContainer.appendChild(form);
  };

  tabApply.onclick = () => {
    tabApply.classList.add("active");
    tabSave.classList.remove("active");
    void renderApplyView();
  };

  tabSave.onclick = () => {
    tabSave.classList.add("active");
    tabApply.classList.remove("active");
    void renderSaveView();
  };

  if (initialTab === "save") {
    void renderSaveView();
  } else {
    void renderApplyView();
  }

  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeTemplatesModal();
  };
}
