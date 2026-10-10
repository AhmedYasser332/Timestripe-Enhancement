/**
 * Pure planning and execution helpers for destructive and cleanup operations.
 * No chrome or fetch access here, so every failure path can be tested with injected ops.
 */

import { NO_PROJECT_ID, type PruneCounts, type SpaceData } from "./types";

export interface GoalNode {
  id: string;
  parent_id: string | null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Walks up the parent chain, stopping on cycles. */
function ancestorsOf(id: string, parents: Map<string, string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = parents.get(id) ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parents.get(cur) ?? null;
  }
  return out;
}

export function findTopLevelRoots(goalIds: string[], parents: Map<string, string | null>): string[] {
  const idSet = new Set(goalIds);
  return goalIds.filter((id) => !ancestorsOf(id, parents).some((a) => idSet.has(a)));
}

export interface BulkDeletePlan {
  /** Selected goals ordered deepest first, so children are removed before their parents. */
  selected: string[];
  /** Unselected children of selected goals, moved out before anything is removed. */
  reparent: Array<{ goalId: string; parentId: string | null }>;
}

/**
 * Timestripe cascades deletes to every descendant. Any UNSELECTED direct child of a
 * selected goal is moved to its nearest unselected ancestor (or top level) first, so
 * it survives at any depth. Selected goals are then removed deepest-first.
 */
export function planBulkDelete(selectedIds: string[], goals: GoalNode[]): BulkDeletePlan {
  const parents = new Map(goals.map((g) => [g.id, g.parent_id]));
  const selected = new Set(selectedIds.filter((id) => parents.has(id)));

  const nearestUnselectedAncestor = (id: string): string | null => {
    const chain = ancestorsOf(id, parents);
    const target = chain.find((a) => !selected.has(a));
    return target ?? null;
  };

  const reparent = goals
    .filter((g) => !selected.has(g.id) && g.parent_id !== null && selected.has(g.parent_id))
    .map((g) => ({ goalId: g.id, parentId: nearestUnselectedAncestor(g.id) }));

  const ordered = [...selected].sort((a, b) => ancestorsOf(b, parents).length - ancestorsOf(a, parents).length);
  return { selected: ordered, reparent };
}

export interface DeleteOps {
  reparent: (goalId: string, parentId: string | null) => Promise<void>;
  remove: (goalId: string) => Promise<void>;
}

export interface DeleteOutcome {
  deleted: string[];
  failed: Array<{ goalId: string; error: string }>;
  /** Moves that were applied and then reverted because the batch stopped. */
  restored: string[];
  /** Moves that could not be reverted; these goals sit in a new place and need manual review. */
  restoreFailed: Array<{ goalId: string; error: string }>;
  abortReason: string | null;
}

/**
 * Runs the protective moves, then removes selected goals deepest-first. The batch stops at
 * the first failure of either kind:
 * - a failed move: earlier moves are rolled back to their original parents;
 * - a failed removal: no further removal runs, so an ancestor can never cascade over a child
 *   whose own delete was not confirmed.
 */
export async function executeBulkDelete(
  plan: BulkDeletePlan,
  ops: DeleteOps,
  originalParents: Map<string, string | null>,
): Promise<DeleteOutcome> {
  const applied: string[] = [];
  const restored: string[] = [];
  const restoreFailed: DeleteOutcome["restoreFailed"] = [];

  const rollbackMoves = async (): Promise<void> => {
    for (const goalId of [...applied].reverse()) {
      try {
        await ops.reparent(goalId, originalParents.get(goalId) ?? null);
        restored.push(goalId);
      } catch (e) {
        restoreFailed.push({ goalId, error: errorMessage(e) });
      }
    }
  };

  for (const move of plan.reparent) {
    try {
      await ops.reparent(move.goalId, move.parentId);
      applied.push(move.goalId);
    } catch (e) {
      await rollbackMoves();
      return {
        deleted: [],
        failed: plan.selected.map((goalId) => ({ goalId, error: "not attempted" })),
        restored,
        restoreFailed,
        abortReason: `Could not protect unselected subgoal ${move.goalId}: ${errorMessage(e)}`,
      };
    }
  }

  const deleted: string[] = [];
  const failed: DeleteOutcome["failed"] = [];
  for (let i = 0; i < plan.selected.length; i++) {
    const goalId = plan.selected[i];
    try {
      await ops.remove(goalId);
      deleted.push(goalId);
    } catch (e) {
      failed.push({ goalId, error: errorMessage(e) });
      // Stop here: removing any ancestor now could cascade over this goal's subtree.
      for (const rest of plan.selected.slice(i + 1)) failed.push({ goalId: rest, error: "not attempted" });
      await rollbackMoves();
      return {
        deleted,
        failed,
        restored,
        restoreFailed,
        abortReason: `Stopped after removal of ${goalId} failed: ${errorMessage(e)}`,
      };
    }
  }
  return { deleted, failed, restored, restoreFailed, abortReason: null };
}

function partition<V>(
  record: Record<string, V> | undefined,
  keep: (id: string, value: V) => boolean,
): { kept: Record<string, V>; removed: number } {
  const kept: Record<string, V> = {};
  let removed = 0;
  for (const [id, value] of Object.entries(record ?? {})) {
    if (keep(id, value)) kept[id] = value;
    else removed++;
  }
  return { kept, removed };
}

/**
 * Decides which local entries are stale. An entry is kept only if its goal exists
 * somewhere in the account (aliveIds is the union over ALL spaces). Project links are
 * also dropped when they point at a missing project; the explicit NO_PROJECT_ID is
 * a valid state and is never treated as a missing project.
 */
export function planPrune(
  data: SpaceData,
  aliveIds: Set<string>,
  validProjectIds: Set<string>,
): { next: SpaceData; counts: PruneCounts } {
  const links = partition(
    data.taskProjectLinks,
    (id, link) =>
      aliveIds.has(id) && (link.projectId === NO_PROJECT_ID || validProjectIds.has(link.projectId)),
  );
  const overrides = partition(data.taskColorOverrides, (id) => aliveIds.has(id));
  const texts = partition(data.taskTextConfigs, (id) => aliveIds.has(id));
  const notes = partition(data.taskProgressNotes, (id) => aliveIds.has(id));

  const counts: PruneCounts = {
    prunedLinks: links.removed,
    prunedOverrides: overrides.removed,
    prunedTexts: texts.removed,
    prunedNotes: notes.removed,
    total: links.removed + overrides.removed + texts.removed + notes.removed,
  };

  const next: SpaceData = {
    ...data,
    taskProjectLinks: links.kept,
    taskColorOverrides: overrides.kept,
    taskTextConfigs: texts.kept,
    taskProgressNotes: notes.kept,
  };
  return { next, counts };
}

export class CreationAbortedError extends Error {
  constructor(
    message: string,
    readonly createdIds: string[],
    readonly leftoverIds: string[],
  ) {
    super(message);
  }
}

/**
 * Runs a multi-step creation. Every created id must be reported through `track`
 * immediately after its create call. If any step throws, the tracked goals are
 * removed in reverse order. Ids that could not be removed are returned as leftovers.
 */
export async function withCreationRollback(
  body: (track: (id: string) => void) => Promise<void>,
  remove: (id: string) => Promise<void>,
): Promise<string[]> {
  const created: string[] = [];
  try {
    await body((id) => created.push(id));
    return created;
  } catch (e) {
    const leftoverIds: string[] = [];
    for (const id of [...created].reverse()) {
      try {
        await remove(id);
      } catch {
        leftoverIds.push(id);
      }
    }
    const rolledBack = created.length - leftoverIds.length;
    throw new CreationAbortedError(
      `${errorMessage(e)}. Rolled back ${rolledBack} of ${created.length} created goals` +
        (leftoverIds.length > 0 ? `; ${leftoverIds.length} could not be removed (ids: ${leftoverIds.join(", ")})` : ""),
      created,
      leftoverIds,
    );
  }
}

/** Returns a human-readable problem with an imported backup, or null when it is structurally valid. */
export function backupProblem(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return "backup is not an object";
  const p = payload as Record<string, unknown>;
  if (typeof p.schemaVersion !== "number" || p.schemaVersion < 1 || p.schemaVersion > 2) {
    return "unsupported or missing schemaVersion";
  }
  const isSpaceData = (d: unknown): string | null => {
    if (!d || typeof d !== "object") return "space data is not an object";
    const s = d as Record<string, unknown>;
    if (s.projects !== undefined && !Array.isArray(s.projects)) return "projects must be an array";
    if (s.templates !== undefined && !Array.isArray(s.templates)) return "templates must be an array";
    for (const key of ["taskProjectLinks", "taskColorOverrides", "taskTextConfigs", "taskProgressNotes"]) {
      const v = s[key];
      if (v !== undefined && (typeof v !== "object" || v === null || Array.isArray(v))) {
        return `${key} must be an object`;
      }
    }
    return null;
  };
  if (!p.data) return "missing data object";
  const top = isSpaceData(p.data);
  if (top) return top;
  if (p.perSpace !== undefined) {
    if (typeof p.perSpace !== "object" || p.perSpace === null || Array.isArray(p.perSpace)) {
      return "perSpace must be an object";
    }
    for (const [spaceId, d] of Object.entries(p.perSpace as Record<string, unknown>)) {
      const problem = isSpaceData(d);
      if (problem) return `space ${spaceId}: ${problem}`;
    }
  }
  return null;
}

export type SpaceWrite = {
  links: Record<string, { projectId: string }>;
  colors: Record<string, string>;
};

/**
 * Commits project links and colors per space. If any space write fails, every write already
 * committed is undone for the same goal ids, and the original error is rethrown so the caller's
 * creation rollback still runs.
 */
export async function commitMetadataAtomically(
  writes: Map<string, SpaceWrite>,
  newIds: Set<string>,
  update: (
    spaceId: string,
    mutate: (d: SpaceData) => SpaceData,
  ) => Promise<unknown>,
): Promise<void> {
  const committed: string[] = [];
  try {
    for (const [spaceId, w] of writes) {
      await update(spaceId, (d) => ({
        ...d,
        taskProjectLinks: { ...d.taskProjectLinks, ...w.links },
        taskColorOverrides: { ...(d.taskColorOverrides ?? {}), ...w.colors },
      }));
      committed.push(spaceId);
    }
  } catch (e) {
    for (const spaceId of committed) {
      await update(spaceId, (d) => ({
        ...d,
        taskProjectLinks: Object.fromEntries(Object.entries(d.taskProjectLinks).filter(([id]) => !newIds.has(id))),
        taskColorOverrides: Object.fromEntries(
          Object.entries(d.taskColorOverrides ?? {}).filter(([id]) => !newIds.has(id)),
        ),
      })).catch(() => {});
    }
    throw e;
  }
}
