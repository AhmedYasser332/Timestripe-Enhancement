import { describe, expect, it, vi } from "vitest";
import {
  bulkDeleteGoals,
  smartDuplicate,
  type ClientLike,
  type OpsDeps,
} from "../src/background/operations";
import type { DuplicateOptions } from "../src/shared/messages";
import type { SpaceData, TSGoal, TSSpace } from "../src/shared/types";

function createMockGoal(partial: Partial<TSGoal> & { id: string; space_id: string }): TSGoal {
  return {
    bucket_id: null,
    parent_id: null,
    horizon: null,
    date: null,
    start_time: null,
    end_time: null,
    name: "Mock Goal",
    description: "",
    checked: false,
    color: null,
    url: "",
    created_datetime: "2026-10-09T00:00:00Z",
    ...partial,
  };
}

function createMockEnv(initialGoals: TSGoal[], initialStorage: Record<string, SpaceData>) {
  const goalsMap = new Map<string, TSGoal>(initialGoals.map((g) => [g.id, { ...g }]));
  const storageMap = new Map<string, SpaceData>(
    Object.entries(initialStorage).map(([id, d]) => [
      id,
      {
        projects: [...(d.projects ?? [])],
        taskProjectLinks: { ...(d.taskProjectLinks ?? {}) },
        taskColorOverrides: { ...(d.taskColorOverrides ?? {}) },
        taskTextConfigs: { ...(d.taskTextConfigs ?? {}) },
        taskProgressNotes: { ...(d.taskProgressNotes ?? {}) },
      },
    ]),
  );

  const spaces: TSSpace[] = [
    { id: "sp1", name: "Work" },
    { id: "sp2", name: "Personal" },
  ];

  let nextIdCounter = 1000;
  const createdIds: string[] = [];
  const deletedIds: string[] = [];
  const reparented: Array<{ id: string; parentId: string | null }> = [];

  let failOnDeleteId: string | null = null;
  let failOnStorageWriteSpaceId: string | null = null;

  const client: ClientLike = {
    listSpaces: async () => spaces,
    listGoals: async (spaceId: string) =>
      [...goalsMap.values()].filter((g) => g.space_id === spaceId),
    createGoal: async (payload: Partial<TSGoal>) => {
      const id = `new-${++nextIdCounter}`;
      const goal = createMockGoal({
        id,
        space_id: payload.space_id ?? "sp1",
        ...payload,
      });
      goalsMap.set(id, goal);
      createdIds.push(id);
      return goal;
    },
    updateGoal: async (id: string, patch: Partial<TSGoal>) => {
      const existing = goalsMap.get(id);
      if (!existing) throw new Error(`Goal ${id} not found in mock`);
      if (patch.parent_id !== undefined) {
        reparented.push({ id, parentId: patch.parent_id });
      }
      Object.assign(existing, patch);
      return existing;
    },
    deleteGoal: async (id: string) => {
      if (id === failOnDeleteId) {
        throw new Error(`API 503 Service Unavailable for deleting ${id}`);
      }
      if (!goalsMap.has(id)) throw new Error(`Goal ${id} not found`);
      goalsMap.delete(id);
      deletedIds.push(id);
    },
  };

  let broadcastCount = 0;
  const deps: OpsDeps = {
    client,
    getAllStoredSpaceData: async () => storageMap,
    updateSpaceData: async (spaceId: string, mutate: (d: SpaceData) => SpaceData) => {
      if (spaceId === failOnStorageWriteSpaceId) {
        throw new Error(`QUOTA_BYTES_PER_ITEM exceeded on space ${spaceId}`);
      }
      const cur = storageMap.get(spaceId) ?? {
        projects: [],
        taskProjectLinks: {},
        taskColorOverrides: {},
        taskTextConfigs: {},
        taskProgressNotes: {},
      };
      const next = mutate(cur);
      storageMap.set(spaceId, next);
      return next;
    },
    broadcastStateChanged: async () => {
      broadcastCount++;
    },
  };

  return {
    client,
    deps,
    goalsMap,
    storageMap,
    createdIds,
    deletedIds,
    reparented,
    getBroadcastCount: () => broadcastCount,
    setFailOnDeleteId: (id: string | null) => {
      failOnDeleteId = id;
    },
    setFailOnStorageWrite: (spaceId: string | null) => {
      failOnStorageWriteSpaceId = spaceId;
    },
  };
}

describe("Operations Integration Suite (Service Worker & Storage)", () => {
  describe("bulkDeleteGoals with Intentional API Failure", () => {
    it("stops cleanly on child failure: parent is never touched, and storage only purges confirmed deleted goals", async () => {
      // Tree: Month (m) -> Week (w1) -> Day 1 (d1)
      // Both w1 and m are selected for deletion. d1 is unselected and must be protected.
      const initialGoals = [
        createMockGoal({ id: "m", space_id: "sp1", name: "October Month", parent_id: null }),
        createMockGoal({ id: "w1", space_id: "sp1", name: "Week 1", parent_id: "m" }),
        createMockGoal({ id: "d1", space_id: "sp1", name: "Day 1 (Keep me)", parent_id: "w1" }),
      ];

      const initialStorage: Record<string, SpaceData> = {
        sp1: {
          projects: [{ id: "p1", name: "Quran", color: "#22c55e", spaceId: "sp1", parentId: null, createdAt: "", updatedAt: "", archived: false }],
          taskProjectLinks: {
            m: { projectId: "p1" },
            w1: { projectId: "p1" },
            d1: { projectId: "p1" },
          },
          taskColorOverrides: {
            m: "#ff0000",
            w1: "#00ff00",
          },
          taskProgressNotes: {
            w1: "50%",
          },
        },
      };

      const env = createMockEnv(initialGoals, initialStorage);
      // Simulate API failure when trying to delete w1
      env.setFailOnDeleteId("w1");

      const res = await bulkDeleteGoals(env.deps, ["m", "w1"]);

      expect(res.completed).toBe(0);
      expect(res.failed).toBe(2);
      expect(res.errors[0]).toContain("Stopped after removal of w1 failed");

      // Verify Timestripe API integrity:
      // 1. Month 'm' was NOT deleted (saving it from cascade corruption!)
      expect(env.goalsMap.has("m")).toBe(true);
      // 2. Week 'w1' was not deleted
      expect(env.goalsMap.has("w1")).toBe(true);
      // 3. Subgoal 'd1' was safely protected
      expect(env.goalsMap.has("d1")).toBe(true);

      // Verify Storage integrity:
      // No confirmed deletion happened, so ALL storage metadata remains 100% intact!
      const sp1Data = env.storageMap.get("sp1")!;
      expect(sp1Data.taskProjectLinks.m).toEqual({ projectId: "p1" });
      expect(sp1Data.taskProjectLinks.w1).toEqual({ projectId: "p1" });
      expect(sp1Data.taskColorOverrides.m).toBe("#ff0000");
      expect(sp1Data.taskProgressNotes.w1).toBe("50%");
    });

    it("handles partial success: child succeeds, parent fails -> child is purged from storage, but unselected kid is NOT restored under deleted child", async () => {
      // Tree: Month (m) -> Week (w1) -> Day (d1, unselected)
      const initialGoals = [
        createMockGoal({ id: "m", space_id: "sp1", name: "October Month", parent_id: null }),
        createMockGoal({ id: "w1", space_id: "sp1", name: "Week 1", parent_id: "m" }),
        createMockGoal({ id: "d1", space_id: "sp1", name: "Day 1 (Unselected)", parent_id: "w1" }),
      ];

      const initialStorage: Record<string, SpaceData> = {
        sp1: {
          projects: [],
          taskProjectLinks: {
            m: { projectId: "p1" },
            w1: { projectId: "p1" },
          },
          taskColorOverrides: {
            w1: "#10b981",
          },
          taskProgressNotes: {
            w1: "15m",
          },
        },
      };

      const env = createMockEnv(initialGoals, initialStorage);
      // w1 will delete successfully, but m will fail
      env.setFailOnDeleteId("m");

      const res = await bulkDeleteGoals(env.deps, ["m", "w1"]);

      expect(res.completed).toBe(1); // w1 deleted
      expect(res.failed).toBe(1); // m failed
      expect(env.deletedIds).toEqual(["w1"]);

      // In Timestripe:
      expect(env.goalsMap.has("w1")).toBe(false);
      expect(env.goalsMap.has("m")).toBe(true);
      expect(env.goalsMap.has("d1")).toBe(true);

      // d1 was moved to top level or nearest survivor before w1 was deleted.
      // Because w1 was successfully deleted, d1 must NOT be restored to w1!
      expect(res.errors.some((e) => e.includes("d1 was not moved back: original parent w1 was deleted"))).toBe(true);

      // In Storage:
      // w1 was confirmed deleted -> purged from links, overrides, and progress notes
      const sp1Data = env.storageMap.get("sp1")!;
      expect(sp1Data.taskProjectLinks.w1).toBeUndefined();
      expect(sp1Data.taskColorOverrides.w1).toBeUndefined();
      expect(sp1Data.taskProgressNotes.w1).toBeUndefined();
      // m failed -> m's project link remains intact
      expect(sp1Data.taskProjectLinks.m).toEqual({ projectId: "p1" });
    });
  });

  describe("smartDuplicate with Intentional chrome.storage Failure", () => {
    it("rolls back all created goals in Timestripe when local storage metadata commit throws, leaving 0 ghost goals", async () => {
      // Set up a goal tree in Timestripe: Parent with 2 children
      const initialGoals = [
        createMockGoal({ id: "root-1", space_id: "sp1", name: "Goal Root", date: "2026-10-09", parent_id: null }),
        createMockGoal({ id: "sub-1", space_id: "sp1", name: "Subgoal 1", date: "2026-10-10", parent_id: "root-1" }),
        createMockGoal({ id: "sub-2", space_id: "sp1", name: "Subgoal 2", date: "2026-10-11", parent_id: "root-1" }),
      ];

      const initialStorage: Record<string, SpaceData> = {
        sp1: {
          projects: [{ id: "proj-work", name: "Work", color: "#3b82f6", spaceId: "sp1", parentId: null, createdAt: "", updatedAt: "", archived: false }],
          taskProjectLinks: {
            "root-1": { projectId: "proj-work" },
            "sub-1": { projectId: "proj-work" },
          },
          taskColorOverrides: {
            "root-1": "#ec4899",
          },
        },
      };

      const env = createMockEnv(initialGoals, initialStorage);

      // Simulate chrome.storage quota failure when writing to space 'sp1'
      env.setFailOnStorageWrite("sp1");

      const options: DuplicateOptions = {
        scope: "tree",
        copyProject: true,
        copyColors: true,
        copyNotes: true,
        copyHorizon: true,
        copyDates: true,
        copyCompletion: false,
      };

      // Execution must fail and throw CreationAbortedError
      await expect(smartDuplicate(env.deps, "root-1", options)).rejects.toThrow(
        /QUOTA_BYTES_PER_ITEM exceeded on space sp1/,
      );

      // Verify that all created goals in Timestripe were rolled back via deleteGoal!
      // In the mock, createdIds had 3 new goals generated, but then they were deleted.
      expect(env.createdIds.length).toBe(3);
      expect(env.deletedIds.length).toBe(3);
      expect(env.deletedIds).toEqual([...env.createdIds].reverse());

      // Only the original 3 goals remain in Timestripe!
      expect(env.goalsMap.size).toBe(3);
      expect(env.goalsMap.has("root-1")).toBe(true);
      expect(env.goalsMap.has("sub-1")).toBe(true);
      expect(env.goalsMap.has("sub-2")).toBe(true);

      // Storage remains clean with only original links and no stale orphan entries:
      const sp1Data = env.storageMap.get("sp1")!;
      expect(Object.keys(sp1Data.taskProjectLinks)).toEqual(["root-1", "sub-1"]);
    });

    it("succeeds cleanly when API and Storage operations both succeed", async () => {
      const initialGoals = [
        createMockGoal({ id: "root-2", space_id: "sp1", name: "Target Goal", date: "2026-10-15", parent_id: null }),
        createMockGoal({ id: "sub-3", space_id: "sp1", name: "Sub 3", date: "2026-10-16", parent_id: "root-2" }),
      ];

      const initialStorage: Record<string, SpaceData> = {
        sp1: {
          projects: [],
          taskProjectLinks: {
            "root-2": { projectId: "p-target" },
          },
          taskColorOverrides: {
            "root-2": "#8b5cf6",
          },
        },
      };

      const env = createMockEnv(initialGoals, initialStorage);

      const options: DuplicateOptions = {
        scope: "tree",
        copyProject: true,
        copyColors: true,
        copyNotes: true,
        copyHorizon: true,
        copyDates: true,
        copyCompletion: true,
        targetAnchorDate: "2026-11-01",
      };

      const res = await smartDuplicate(env.deps, "root-2", options);

      expect(res.totalCreated).toBe(2);
      expect(res.newRootId).toBeTruthy();
      expect(env.goalsMap.size).toBe(4); // 2 original + 2 duplicated

      // Check dates shifted according to targetAnchorDate (2026-10-15 -> 2026-11-01 is +17 days)
      const newRoot = env.goalsMap.get(res.newRootId)!;
      expect(newRoot.date).toBe("2026-11-01");
      expect(newRoot.name).toBe("Target Goal (Copy)");

      // Check that storage link was duplicated to the new root
      const sp1Data = env.storageMap.get("sp1")!;
      expect(sp1Data.taskProjectLinks[res.newRootId]).toEqual({ projectId: "p-target" });
      expect(sp1Data.taskColorOverrides[res.newRootId]).toBe("#8b5cf6");

      expect(env.getBroadcastCount()).toBe(1);
    });
  });
});
