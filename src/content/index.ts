// Content script entry (PRD §44): DOM observation + indicator rendering.
// Reads via the adapter and reacts live to storage changes.

import { applyBadge, injectStyles } from "./badges";
import { observeGoalList, scanGoalRows } from "./adapter";
import { captureMenuTarget, scanForNativeMenus } from "./menu-integration";
import {
  checkUnknownGoals,
  getTaskTextConfigs,
  getViewState,
  initLiveState,
  registerDomParents,
} from "./state";
import { initSelectionUI, reconcileCheckboxes } from "./selection-ui";
import { initMarqueeSelection } from "./marquee";
import { initGlobalHistoryShortcuts } from "./history";
import { scanAndInjectEditorToolbar } from "./editor-toolbar";
import { initDashboardShortcut, injectSidebarButton, refreshDashboardModalIfOpen } from "./dashboard-modal";

function renderAll(): void {
  const viewState = getViewState();
  const textConfigs = getTaskTextConfigs();
  const rows = scanGoalRows();
  const visibleIds: string[] = [];
  const domParents: Array<{ goalId: string; parentId: string }> = [];

  for (const { goalId, row, domParentId } of rows.values()) {
    visibleIds.push(goalId);
    if (domParentId) {
      domParents.push({ goalId, parentId: domParentId });
    }
    applyBadge(row, viewState.assignments[goalId] ?? null, viewState.settings, textConfigs[goalId]);
  }

  if (domParents.length > 0) {
    registerDomParents(domParents);
  }
  checkUnknownGoals(visibleIds);
  reconcileCheckboxes();
  scanAndInjectEditorToolbar();
  injectSidebarButton();
  refreshDashboardModalIfOpen();
}

// Track goal click target for native "..." menu integration (PRD §55)
document.addEventListener("click", (e) => captureMenuTarget(e.target), true);

injectStyles();
initSelectionUI();
initMarqueeSelection();
initGlobalHistoryShortcuts();
initDashboardShortcut();
injectSidebarButton();

// Live reactive state: when settings change (strip ↔ full, project name toggle)
// or projects/assignments change, this callback runs IMMEDIATELY.
initLiveState(renderAll);

// DOM re-renders and SPA navigation
observeGoalList(() => {
  renderAll();
  scanForNativeMenus();
  scanAndInjectEditorToolbar();
  injectSidebarButton();
});
