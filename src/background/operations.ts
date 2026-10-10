/**
 * Destructive and multi-step operations (bulk delete, smart duplicate) with every external
 * dependency injected. The service worker wires the real Timestripe client and chrome.storage
 * helpers in; tests wire in fakes that can fail on any call.
 */

import type { TimestripeApi } from "../shared/api";
import { addDays, computeDayOffset } from "../shared/dates";
import type { BulkDeleteResult, DuplicateOptions, SmartDuplicateResult } from "../shared/messages";
import {
  CreationAbortedError,
  commitMetadataAtomically,
  executeBulkDelete,
  findTopLevelRoots,
  planBulkDelete,
  withCreationRollback,
  type SpaceWrite,
} from "../shared/planning";
import type { SpaceData, TaskProjectLink, TSGoal } from "../shared/types";

export type ClientLike = Pick<TimestripeApi, "listSpaces" | "listGoals" | "updateGoal" | "createGoal" | "deleteGoal">;

export interface OpsDeps {
  client: ClientLike;
  getAllStoredSpaceData: () => Promise<Map<string, SpaceData>>;
  updateSpaceData: (spaceId: string, mutate: (d: SpaceData) => SpaceData) => Promise<unknown>;
  broadcastStateChanged: () => Promise<void>;
}

type LocatedGoal = { goal: TSGoal; spaceId: string };

/** Loads every goal of every space. Any read failure throws, so callers never act on a partial picture. */
export async function loadAllGoals(client: ClientLike): Promise<Map<string, LocatedGoal>> {
  const spaces = await client.listSpaces();
  const byId = new Map<string, LocatedGoal>();
  for (const s of spaces) {
    for (const goal of await client.listGoals(s.id)) byId.set(goal.id, { goal, spaceId: s.id });
  }
  return byId;
}

/** Removes local metadata for goals confirmed deleted, from every space partition. */
export async function purgeGoalIds(deps: OpsDeps, goalIds: string[]): Promise<void> {
  if (goalIds.length === 0) return;
  const doomed = new Set(goalIds);
  const keep = <V,>(rec: Record<string, V> | undefined): Record<string, V> =>
    Object.fromEntries(Object.entries(rec ?? {}).filter(([id]) => !doomed.has(id)));
  for (const spaceId of (await deps.getAllStoredSpaceData()).keys()) {
    await deps.updateSpaceData(spaceId, (d) => ({
      ...d,
      taskProjectLinks: keep(d.taskProjectLinks),
      taskColorOverrides: keep(d.taskColorOverrides),
      taskTextConfigs: keep(d.taskTextConfigs),
      taskProgressNotes: keep(d.taskProgressNotes),
    }));
  }
}

export async function bulkDeleteGoals(deps: OpsDeps, goalIds: string[]): Promise<BulkDeleteResult> {
  const { client } = deps;
  const byId = await loadAllGoals(client);
  const plan = planBulkDelete(
    goalIds.filter((id) => byId.has(id)),
    [...byId.values()].map(({ goal }) => ({ id: goal.id, parent_id: goal.parent_id })),
  );
  const missing = goalIds.filter((id) => !byId.has(id));
  const originalParents = new Map([...byId.values()].map(({ goal }) => [goal.id, goal.parent_id] as const));

  const outcome = await executeBulkDelete(
    plan,
    {
      reparent: async (goalId, parentId) => {
        await client.updateGoal(goalId, { parent_id: parentId });
      },
      remove: (goalId) => client.deleteGoal(goalId),
    },
    originalParents,
  );

  await purgeGoalIds(deps, outcome.deleted);
  await deps.broadcastStateChanged();

  const errors = [
    ...(outcome.abortReason ? [outcome.abortReason] : []),
    ...outcome.failed.filter((f) => f.error !== "not attempted").map((f) => `${f.goalId}: ${f.error}`),
    ...outcome.restoreSkipped.map((f) => `${f.goalId} was not moved back: ${f.reason}`),
    ...outcome.restoreFailed.map((f) => `restore ${f.goalId} to its original parent failed: ${f.error}`),
    ...missing.map((id) => `${id}: not found`),
  ];
  const notDeleted = plan.selected.length - outcome.deleted.length;
  return { completed: outcome.deleted.length, failed: notDeleted + missing.length, errors };
}

export async function smartDuplicate(
  deps: OpsDeps,
  goalIdsInput: string | string[],
  options: DuplicateOptions,
): Promise<SmartDuplicateResult> {
  const { client } = deps;
  const goalIds = Array.isArray(goalIdsInput) ? goalIdsInput : [goalIdsInput];
  if (goalIds.length === 0) throw new Error("No goals specified for duplication");

  const byId = await loadAllGoals(client);
  for (const id of goalIds) {
    if (!byId.has(id)) throw new Error(`Goal ${id} not found`);
  }

  const parents: Record<string, string | null> = {};
  const childrenMap = new Map<string, TSGoal[]>();
  for (const { goal: g } of byId.values()) {
    parents[g.id] = g.parent_id;
    if (g.parent_id) {
      const list = childrenMap.get(g.parent_id) ?? [];
      list.push(g);
      childrenMap.set(g.parent_id, list);
    }
  }

  const roots = options.scope === "tree" ? findTopLevelRoots(goalIds, new Map(Object.entries(parents))) : goalIds;
  const oldToNew = new Map<string, string>();
  const newSpaceOf = new Map<string, string>();
  const newRootIds: string[] = [];

  // One transaction: goal creation and metadata writes. Any failure rolls back every created goal.
  const createdIds = await withCreationRollback(async (track) => {
    const make = async (payload: Partial<TSGoal> & { space_id: string }, oldId: string | null): Promise<TSGoal> => {
      const created = await client.createGoal(payload);
      track(created.id);
      if (oldId) oldToNew.set(oldId, created.id);
      newSpaceOf.set(created.id, payload.space_id);
      return created;
    };

    for (const rootId of roots) {
      const rootLoc = byId.get(rootId)!;
      const rootGoal = rootLoc.goal;
      const spaceId = rootLoc.spaceId;

      const treeGoals: TSGoal[] = [rootGoal];
      const queue = [rootId];
      while (options.scope === "tree" && queue.length > 0) {
        const pId = queue.shift()!;
        for (const k of childrenMap.get(pId) ?? []) {
          treeGoals.push(k);
          queue.push(k.id);
        }
      }

      // Anchor on the root's date; if the root is undated, use the earliest dated task in its tree.
      let baseAnchorDate: string | null = rootGoal.date;
      if (!baseAnchorDate) {
        const dated = treeGoals.filter((g) => g.date != null).map((g) => g.date as string).sort();
        baseAnchorDate = dated[0] ?? null;
      }
      const dayOffset =
        options.copyDates && options.targetAnchorDate && baseAnchorDate
          ? computeDayOffset(baseAnchorDate, options.targetAnchorDate)
          : 0;

      const computeDate = (origDate: string | null, isRoot: boolean): string | null => {
        if (!options.copyDates) return null;
        if (origDate) return dayOffset !== 0 ? addDays(origDate, dayOffset) : origDate;
        if (isRoot && options.targetAnchorDate && !baseAnchorDate) return options.targetAnchorDate;
        return null;
      };

      const createdRoot = await make(
        {
          space_id: spaceId,
          parent_id: rootGoal.parent_id,
          bucket_id: rootGoal.bucket_id,
          horizon: options.copyHorizon ? rootGoal.horizon : null,
          date: computeDate(rootGoal.date, true),
          name: `${rootGoal.name} (Copy)`,
          description: options.copyNotes ? rootGoal.description : "",
          checked: options.copyCompletion ? rootGoal.checked : false,
        },
        rootGoal.id,
      );
      newRootIds.push(createdRoot.id);

      if (options.scope === "tree") {
        const bfs: Array<{ original: TSGoal; newParentId: string }> = (childrenMap.get(rootId) ?? []).map((c) => ({
          original: c,
          newParentId: createdRoot.id,
        }));
        while (bfs.length > 0) {
          const item = bfs.shift()!;
          const orig = item.original;
          const child = await make(
            {
              space_id: spaceId,
              parent_id: item.newParentId,
              bucket_id: orig.bucket_id,
              horizon: options.copyHorizon ? orig.horizon : null,
              date: computeDate(orig.date, false),
              name: orig.name,
              description: options.copyNotes ? orig.description : "",
              checked: options.copyCompletion ? orig.checked : false,
            },
            orig.id,
          );
          for (const next of childrenMap.get(orig.id) ?? []) bfs.push({ original: next, newParentId: child.id });
        }
      }
    }

    if (options.copyProject || options.copyColors) {
      const stored = await deps.getAllStoredSpaceData();
      const writes = new Map<string, SpaceWrite>();
      for (const [oldId, newId] of oldToNew) {
        const target = newSpaceOf.get(newId)!;
        const srcData = stored.get(byId.get(oldId)!.spaceId);
        const link: TaskProjectLink | undefined = srcData?.taskProjectLinks[oldId];
        const color = srcData?.taskColorOverrides?.[oldId];
        const bucket = writes.get(target) ?? { links: {}, colors: {} };
        if (options.copyProject && link) bucket.links[newId] = link;
        if (options.copyColors && color) bucket.colors[newId] = color;
        writes.set(target, bucket);
      }
      await commitMetadataAtomically(writes, new Set(oldToNew.values()), deps.updateSpaceData);
    }
  }, (id) => client.deleteGoal(id));

  await deps.broadcastStateChanged();
  return { newRootId: newRootIds[0] ?? "", newRootIds, totalCreated: createdIds.length };
}

export { CreationAbortedError };
