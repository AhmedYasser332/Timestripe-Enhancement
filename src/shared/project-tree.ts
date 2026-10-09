/**
 * Project tree helpers (sub-projects). Pure functions — no chrome APIs — so
 * they run in the service worker, the popup and the content script alike.
 *
 * Rules settled with the user (2026-10-05):
 * - Unlimited nesting (UI tuned for 1–2 levels).
 * - A sub without an explicit color inherits its nearest ancestor's color.
 * - A sub always shares its parent's scope (cascade-updated on scope change).
 */

import type { Project } from "./types";

export const INHERITED_COLOR_FALLBACK = "#8a8a8a";

/** True when the project deliberately has no color of its own. */
export function hasOwnColor(p: Project): boolean {
  return typeof p.color === "string" && p.color.trim().length > 0;
}

/** Nearest ancestor-or-self color; falls back to a neutral gray. */
export function effectiveColor(projects: Project[], id: string): string {
  const byId = new Map(projects.map((p) => [p.id, p]));
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (hasOwnColor(cur)) return cur.color;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return INHERITED_COLOR_FALLBACK;
}

/** Chain root → … → self (inclusive). Handles orphaned parentId (missing node). */
export function projectPath(projects: Project[], id: string): Project[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const path: Project[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** All strict descendants (children, grandchildren, …) — order: breadth-first. */
export function descendantsOf(projects: Project[], id: string): Project[] {
  const byParent = new Map<string, Project[]>();
  for (const p of projects) {
    if (!p.parentId) continue;
    const list = byParent.get(p.parentId) ?? [];
    list.push(p);
    byParent.set(p.parentId, list);
  }
  const out: Project[] = [];
  let frontier = [id];
  const seen = new Set<string>([id]);
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const pid of frontier) {
      for (const child of byParent.get(pid) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push(child);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return out;
}

export function isDescendant(projects: Project[], ancestorId: string, maybeDescendantId: string): boolean {
  if (ancestorId === maybeDescendantId) return false;
  return descendantsOf(projects, ancestorId).some((p) => p.id === maybeDescendantId);
}

export interface ProjectTreeNode {
  project: Project;
  depth: number;
  children: ProjectTreeNode[];
}

/** Roots and their subtrees; orphans (missing parent) surface as roots. */
export function buildProjectTree(projects: Project[]): ProjectTreeNode[] {
  const nodes = new Map<string, ProjectTreeNode>();
  for (const p of projects) nodes.set(p.id, { project: p, depth: 0, children: [] });

  const roots: ProjectTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.project.parentId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && parent.project.id !== node.project.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const assignDepth = (nodesList: ProjectTreeNode[], depth: number): void => {
    for (const n of nodesList) {
      n.depth = depth;
      assignDepth(n.children, depth + 1);
    }
  };
  assignDepth(roots, 0);
  return roots;
}

/** Flatten a tree in display order (parents before children). */
export function flattenTree(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
  const out: ProjectTreeNode[] = [];
  const walk = (list: ProjectTreeNode[]): void => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Total task count for a project INCLUDING tasks assigned to any descendant
 * (the parent row shows the whole subtree's size).
 */
export function subtreeTaskCount(
  projects: Project[],
  projectId: string,
  directCounts: Map<string, number>,
): number {
  let total = directCounts.get(projectId) ?? 0;
  for (const d of descendantsOf(projects, projectId)) total += directCounts.get(d.id) ?? 0;
  return total;
}

/**
 * Reorders a project (and its entire subtree of descendants) before or after a target project.
 * - Entire subtree (children, grandchildren) moves atomically with the parent.
 * - Prevents circular references (cannot drop a parent onto any of its descendants).
 * - Adopts the target's parentId so it becomes a sibling of the target.
 */
export function reorderProjectTree(
  projects: Project[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
): Project[] {
  if (sourceId === targetId) return projects;

  const descendants = descendantsOf(projects, sourceId);
  const movingIds = new Set([sourceId, ...descendants.map((d) => d.id)]);

  // Cannot drop a project into its own descendant
  if (movingIds.has(targetId)) return projects;

  const targetProject = projects.find((p) => p.id === targetId);
  if (!targetProject) return projects;

  // Moving items in relative order
  const movingItems = projects
    .filter((p) => movingIds.has(p.id))
    .map((p) => {
      // Root of moving subtree adopts target's parentId
      if (p.id === sourceId) {
        return { ...p, parentId: targetProject.parentId ?? null };
      }
      return p;
    });

  const remaining = projects.filter((p) => !movingIds.has(p.id));

  if (position === "before") {
    const targetIdx = remaining.findIndex((p) => p.id === targetId);
    if (targetIdx < 0) return projects;
    remaining.splice(targetIdx, 0, ...movingItems);
  } else {
    // Insert after target AND after all target's descendants
    const targetDescendants = descendantsOf(remaining, targetId);
    const lastTargetItem = targetDescendants[targetDescendants.length - 1] ?? targetProject;
    const lastIdx = remaining.findIndex((p) => p.id === lastTargetItem.id);
    if (lastIdx < 0) return projects;
    remaining.splice(lastIdx + 1, 0, ...movingItems);
  }

  return remaining;
}
