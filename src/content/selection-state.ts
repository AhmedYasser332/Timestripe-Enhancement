/**
 * Tree-aware Selection State Manager (PRD §11–§14).
 * Manages selected goal IDs, tree hierarchy (ancestor/descendant checks),
 * range selection (Shift+Click), and partial/indeterminate state detection.
 */

import { scanGoalRows } from "./adapter";
import { getGoalParents } from "./state";

type SelectionListener = () => void;

let selectedIds = new Set<string>();
let lastAnchorGoalId: string | null = null;
const listeners = new Set<SelectionListener>();

export function subscribeSelection(listener: SelectionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.error("[TSE] Selection listener error", e);
    }
  }
}

export function getSelectedIds(): string[] {
  return Array.from(selectedIds);
}

export function getSelectedCount(): number {
  return selectedIds.size;
}

export function isGoalSelected(goalId: string): boolean {
  return selectedIds.has(goalId);
}

export function setSelectionDirect(ids: string[]): void {
  selectedIds = new Set(ids);
  notify();
}

/** Returns all descendants of a goal using the indexed parent map (all depths, PRD §13.1). */
export function getDescendants(rootId: string): string[] {
  const parents = getGoalParents();
  const childrenMap = new Map<string, string[]>();

  for (const [childId, parentId] of Object.entries(parents)) {
    if (parentId) {
      const list = childrenMap.get(parentId) ?? [];
      list.push(childId);
      childrenMap.set(parentId, list);
    }
  }

  const out: string[] = [];
  const queue = [...(childrenMap.get(rootId) ?? [])];
  const visited = new Set<string>([rootId]);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);
    out.push(curr);
    const next = childrenMap.get(curr);
    if (next) queue.push(...next);
  }

  return out;
}

/** Check selection status of a goal tree: checked, unchecked, or partial (PRD §13.3). */
export type TreeSelectionState = "checked" | "unchecked" | "partial";

export function getTreeSelectionState(goalId: string): {
  state: TreeSelectionState;
  totalDescendants: number;
  selectedDescendants: number;
} {
  const isSelfSelected = selectedIds.has(goalId);
  const descendants = getDescendants(goalId);
  if (descendants.length === 0) {
    return {
      state: isSelfSelected ? "checked" : "unchecked",
      totalDescendants: 0,
      selectedDescendants: 0,
    };
  }

  let selectedCount = 0;
  for (const d of descendants) {
    if (selectedIds.has(d)) selectedCount++;
  }

  const total = descendants.length;

  if (isSelfSelected && selectedCount === total) {
    return { state: "checked", totalDescendants: total, selectedDescendants: selectedCount };
  }

  if (!isSelfSelected && selectedCount === 0) {
    return { state: "unchecked", totalDescendants: total, selectedDescendants: 0 };
  }

  // Mixed or partial
  return { state: "partial", totalDescendants: total, selectedDescendants: selectedCount };
}

/**
 * Toggle a goal:
 * - If unchecked -> selects it and all its descendants (PRD §13.1).
 * - If checked -> unselects it and all its descendants.
 */
export function toggleGoalWithTree(goalId: string): void {
  const info = getTreeSelectionState(goalId);
  const descendants = getDescendants(goalId);

  if (info.state === "unchecked") {
    selectedIds.add(goalId);
    for (const d of descendants) selectedIds.add(d);
  } else {
    selectedIds.delete(goalId);
    for (const d of descendants) selectedIds.delete(d);
  }

  lastAnchorGoalId = goalId;
  notify();
}

/** Select all goals in the subtree (PRD §13.4). */
export function selectEntireSubtree(goalId: string): void {
  selectedIds.add(goalId);
  for (const d of getDescendants(goalId)) {
    selectedIds.add(d);
  }
  lastAnchorGoalId = goalId;
  notify();
}

/** Clear all goals in the subtree (PRD §13.4). */
export function clearSubtree(goalId: string): void {
  selectedIds.delete(goalId);
  for (const d of getDescendants(goalId)) {
    selectedIds.delete(d);
  }
  notify();
}

/** Toggle just an individual goal directly without affecting descendants. */
export function toggleSingleGoal(goalId: string): void {
  if (selectedIds.has(goalId)) {
    selectedIds.delete(goalId);
  } else {
    selectedIds.add(goalId);
  }
  lastAnchorGoalId = goalId;
  notify();
}

/**
 * Shift+Click Range Selection:
 * Selects all visible goal rows in DOM order between lastAnchorGoalId and targetGoalId.
 */
export function selectRangeTo(targetGoalId: string): void {
  const rows = scanGoalRows();
  const visibleGoalIds = Array.from(rows.keys());

  if (!lastAnchorGoalId || !visibleGoalIds.includes(lastAnchorGoalId)) {
    toggleGoalWithTree(targetGoalId);
    return;
  }

  const idx1 = visibleGoalIds.indexOf(lastAnchorGoalId);
  const idx2 = visibleGoalIds.indexOf(targetGoalId);
  if (idx1 === -1 || idx2 === -1) {
    toggleGoalWithTree(targetGoalId);
    return;
  }

  const start = Math.min(idx1, idx2);
  const end = Math.max(idx1, idx2);

  for (let i = start; i <= end; i++) {
    const id = visibleGoalIds[i];
    selectedIds.add(id);
    for (const d of getDescendants(id)) {
      selectedIds.add(d);
    }
  }

  lastAnchorGoalId = targetGoalId;
  notify();
}

/** Set multiple goals selected or unselected (used by Marquee selection). */
export function selectMultiple(goalIds: string[], append = false): void {
  if (!append) {
    selectedIds.clear();
  }
  for (const id of goalIds) {
    selectedIds.add(id);
    for (const d of getDescendants(id)) {
      selectedIds.add(d);
    }
  }
  if (goalIds.length > 0) {
    lastAnchorGoalId = goalIds[goalIds.length - 1];
  }
  notify();
}

/** Clear all selections (PRD §12). */
export function clearAllSelection(): void {
  if (selectedIds.size === 0) return;
  selectedIds.clear();
  notify();
}

/** Normalization helper (PRD §14): returns top-level roots among selected goals. */
export function getSelectedRoots(): string[] {
  const parents = getGoalParents();
  return Array.from(selectedIds).filter((id) => {
    let curr = parents[id];
    while (curr) {
      if (selectedIds.has(curr)) return false;
      curr = parents[curr];
    }
    return true;
  });
}
