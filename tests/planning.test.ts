import { describe, expect, it } from "vitest";
import {
  CreationAbortedError,
  backupProblem,
  executeBulkDelete,
  findTopLevelRoots,
  planBulkDelete,
  planPrune,
  withCreationRollback,
  type GoalNode,
} from "../src/shared/planning";
import { NO_PROJECT_ID, type SpaceData } from "../src/shared/types";

// Month -> Week -> Day tree. d2 is an unselected Day under the selected week w1.
const tree: GoalNode[] = [
  { id: "m", parent_id: null },
  { id: "w1", parent_id: "m" },
  { id: "w2", parent_id: "m" },
  { id: "d1", parent_id: "w1" },
  { id: "d2", parent_id: "w1" },
  { id: "d2a", parent_id: "d2" },
];

/** Simulates Timestripe's cascade: deleting a goal removes its whole subtree from the store. */
function makeStore(goals: GoalNode[]) {
  const alive = new Map(goals.map((g) => [g.id, { ...g }]));
  const removeSubtree = (id: string) => {
    for (const [k, g] of [...alive]) {
      if (k === id) alive.delete(k);
      else if (g.parent_id === id) removeSubtree(k);
    }
  };
  return { alive, removeSubtree };
}

describe("planBulkDelete: partial selection at any depth", () => {
  it("moves an unselected grandchild out before its selected ancestor is deleted", () => {
    // Select month + week; d2 (unselected, under w1) must survive.
    const plan = planBulkDelete(["m", "w1"], tree);
    const d2Move = plan.reparent.find((r) => r.goalId === "d2");
    expect(d2Move).toBeDefined();
    // Its nearest unselected ancestor is the month... which is selected, so it must go to top level.
    expect(d2Move!.parentId).toBeNull();
  });

  it("keeps an unselected child under an unselected ancestor when that ancestor is not deleted", () => {
    const plan = planBulkDelete(["w1"], tree);
    const d2Move = plan.reparent.find((r) => r.goalId === "d2");
    expect(d2Move?.parentId).toBe("m");
  });

  it("deletes deepest-first so no removal cascades into an unselected goal", () => {
    const plan = planBulkDelete(["m", "w1", "d1"], tree);
    expect(plan.selected.indexOf("d1")).toBeLessThan(plan.selected.indexOf("w1"));
    expect(plan.selected.indexOf("w1")).toBeLessThan(plan.selected.indexOf("m"));
  });

  it("protects an unselected deep descendant when the cascade is simulated", async () => {
    const plan = planBulkDelete(["w1"], tree);
    const store = makeStore(tree);
    const outcome = await executeBulkDelete(plan, {
      reparent: async (goalId, parentId) => {
        const g = store.alive.get(goalId)!;
        g.parent_id = parentId;
      },
      remove: async (goalId) => store.removeSubtree(goalId),
    });
    expect(outcome.abortReason).toBeNull();
    expect(store.alive.has("d2")).toBe(true);
    expect(store.alive.has("d2a")).toBe(true);
    expect(store.alive.has("w1")).toBe(false);
    // d1 is an unselected child of w1, so it is moved to m before w1 is removed and survives.
    expect(store.alive.has("d1")).toBe(true);
  });
});

describe("executeBulkDelete: failure injection", () => {
  it("aborts before removing anything when protecting a child fails", async () => {
    const plan = planBulkDelete(["w1"], tree);
    const removed: string[] = [];
    const outcome = await executeBulkDelete(plan, {
      reparent: async () => {
        throw new Error("HTTP 500");
      },
      remove: async (id) => {
        removed.push(id);
      },
    });
    expect(outcome.abortReason).toContain("Could not protect");
    expect(removed).toEqual([]);
    expect(outcome.deleted).toEqual([]);
  });

  it("stops at a failed delete and does not claim the failed goal was deleted", async () => {
    const plan = planBulkDelete(["d1", "w2"], tree);
    const outcome = await executeBulkDelete(
      plan,
      {
        reparent: async () => {},
        remove: async (id) => {
          if (id === "d1") throw new Error("HTTP 503");
        },
      },
      new Map(tree.map((g) => [g.id, g.parent_id])),
    );
    expect(outcome.deleted).toEqual([]);
    expect(outcome.failed[0]).toEqual({ goalId: "d1", error: "HTTP 503" });
  });
});

describe("findTopLevelRoots", () => {
  it("returns only the highest selected goal on each branch", () => {
    const parents = Object.fromEntries(tree.map((g) => [g.id, g.parent_id]));
    expect(findTopLevelRoots(["m", "w1", "d1"], new Map(Object.entries(parents)))).toEqual(["m"]);
  });
});

describe("withCreationRollback: mid-run API failure", () => {
  it("removes every goal created before the failure, in reverse order", async () => {
    const removed: string[] = [];
    let calls = 0;
    const err = await withCreationRollback(
      async (track) => {
        for (const id of ["a", "b", "c", "d", "e"]) {
          calls++;
          if (calls === 5) throw new Error("HTTP 500 on request 5");
          track(id);
        }
      },
      async (id) => {
        removed.push(id);
      },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(CreationAbortedError);
    expect(removed).toEqual(["d", "c", "b", "a"]);
    expect(err.createdIds).toEqual(["a", "b", "c", "d"]);
    expect(err.leftoverIds).toEqual([]);
    expect(err.message).toContain("Rolled back 4 of 4");
  });

  it("reports leftovers when a rollback delete also fails", async () => {
    const err = await withCreationRollback(
      async (track) => {
        track("a");
        track("b");
        throw new Error("boom");
      },
      async (id) => {
        if (id === "b") throw new Error("delete failed");
      },
    ).catch((e) => e);
    expect(err.leftoverIds).toEqual(["b"]);
    expect(err.message).toContain("could not be removed (ids: b)");
  });

  it("returns every created id on success", async () => {
    const ids = await withCreationRollback(
      async (track) => {
        track("x");
        track("y");
      },
      async () => {},
    );
    expect(ids).toEqual(["x", "y"]);
  });
});

function space(partial: Partial<SpaceData>): SpaceData {
  return { projects: [{ id: "p1" } as SpaceData["projects"][number]], taskProjectLinks: {}, ...partial };
}

describe("planPrune: never deletes valid state", () => {
  const alive = new Set(["g1", "g2", "g3"]);
  const validProjects = new Set(["p1"]);

  it("keeps an explicit No Project override", () => {
    const { next, counts } = planPrune(
      space({ taskProjectLinks: { g1: { projectId: NO_PROJECT_ID } } }),
      alive,
      validProjects,
    );
    expect(next.taskProjectLinks.g1).toEqual({ projectId: NO_PROJECT_ID });
    expect(counts.prunedLinks).toBe(0);
  });

  it("removes a link whose goal no longer exists", () => {
    const { next, counts } = planPrune(
      space({ taskProjectLinks: { gone: { projectId: "p1" } } }),
      alive,
      validProjects,
    );
    expect(next.taskProjectLinks.gone).toBeUndefined();
    expect(counts.prunedLinks).toBe(1);
  });

  it("removes a link whose project was deleted, but not a valid one", () => {
    const { next, counts } = planPrune(
      space({ taskProjectLinks: { g1: { projectId: "p-deleted" }, g2: { projectId: "p1" } } }),
      alive,
      validProjects,
    );
    expect(next.taskProjectLinks).toEqual({ g2: { projectId: "p1" } });
    expect(counts.prunedLinks).toBe(1);
  });

  it("keeps progress notes and colors for goals that exist", () => {
    const { next } = planPrune(
      space({ taskColorOverrides: { g1: "#fff" }, taskProgressNotes: { g1: "50%" } }),
      alive,
      validProjects,
    );
    expect(next.taskColorOverrides).toEqual({ g1: "#fff" });
    expect(next.taskProgressNotes).toEqual({ g1: "50%" });
  });
});

describe("backupProblem: import validation", () => {
  it("accepts a valid single-space backup", () => {
    expect(backupProblem({ schemaVersion: 2, data: { projects: [], taskProjectLinks: {} } })).toBeNull();
  });

  it("rejects a missing or wrong schemaVersion", () => {
    expect(backupProblem({ data: {} })).toMatch(/schemaVersion/);
    expect(backupProblem({ schemaVersion: 9, data: {} })).toMatch(/schemaVersion/);
  });

  it("rejects non-object link maps", () => {
    expect(backupProblem({ schemaVersion: 2, data: { taskProjectLinks: [] } })).toMatch(/taskProjectLinks/);
  });

  it("validates each perSpace entry", () => {
    expect(
      backupProblem({ schemaVersion: 2, data: {}, perSpace: { sp1: { projects: "bad" } } }),
    ).toMatch(/space sp1/);
  });
});

describe("executeBulkDelete: child removal fails, ancestor must not be removed", () => {
  it("stops before deleting the month when the week's delete fails", async () => {
    // Month and week are both selected; deleting the week fails.
    const plan = planBulkDelete(["m", "w1"], tree);
    const store = makeStore(tree);
    const removed: string[] = [];
    const outcome = await executeBulkDelete(
      plan,
      {
        reparent: async (goalId, parentId) => {
          store.alive.get(goalId)!.parent_id = parentId;
        },
        remove: async (goalId) => {
          removed.push(goalId);
          if (goalId === "w1") throw new Error("HTTP 503 on week");
          store.removeSubtree(goalId);
        },
      },
      new Map(tree.map((g) => [g.id, g.parent_id])),
    );
    expect(removed).toEqual(["w1"]);
    expect(outcome.abortReason).toContain("Stopped after removal of w1 failed");
    expect(store.alive.has("m")).toBe(true);
    expect(store.alive.has("w1")).toBe(true);
  });

  it("marks goals after the failed removal as not attempted", async () => {
    const plan = { selected: ["d1", "w1", "m"], reparent: [] };
    const outcome = await executeBulkDelete(
      plan,
      {
        reparent: async () => {},
        remove: async (goalId) => {
          if (goalId === "d1") throw new Error("HTTP 500");
        },
      },
      new Map(),
    );
    expect(outcome.deleted).toEqual([]);
    expect(outcome.failed.map((f) => [f.goalId, f.error])).toEqual([
      ["d1", "HTTP 500"],
      ["w1", "not attempted"],
      ["m", "not attempted"],
    ]);
  });
});

describe("executeBulkDelete: restoring moves when a later move fails", () => {
  it("returns an already-moved unselected child to its original parent", async () => {
    const plan = planBulkDelete(["w1"], tree);
    // Protective moves for w1: d1 then d2. Move #2 fails, so d1 must be put back under w1.
    const current = new Map(tree.map((g) => [g.id, g.parent_id]));
    let calls = 0;
    const outcome = await executeBulkDelete(
      plan,
      {
        reparent: async (goalId, parentId) => {
          calls++;
          if (calls === 2) throw new Error("HTTP 500 on second move");
          current.set(goalId, parentId);
        },
        remove: async () => {
          throw new Error("must not run");
        },
      },
      new Map(tree.map((g) => [g.id, g.parent_id])),
    );
    expect(outcome.abortReason).toContain("Could not protect");
    expect(outcome.restored).toEqual(["d1"]);
    expect(outcome.restoreFailed).toEqual([]);
    expect(current.get("d1")).toBe("w1");
  });

  it("reports goals whose original parent could not be restored", async () => {
    const plan = { selected: ["w1"], reparent: [
      { goalId: "d1", parentId: "m" },
      { goalId: "d2", parentId: "m" },
    ] };
    const parents = new Map(tree.map((g) => [g.id, g.parent_id]));
    const outcome = await executeBulkDelete(
      plan,
      {
        reparent: async (goalId, parentId) => {
          if (goalId === "d2") throw new Error("HTTP 500");
          if (parentId === "w1" && goalId === "d1") throw new Error("restore HTTP 503");
        },
        remove: async () => {},
      },
      parents,
    );
    expect(outcome.abortReason).toContain("Could not protect");
    expect(outcome.restoreFailed.map((f) => f.goalId)).toEqual(["d1"]);
  });
});

import { commitMetadataAtomically } from "../src/shared/planning";

describe("commitMetadataAtomically: storage failure during duplicate metadata", () => {
  const emptySpace = (): SpaceData => ({ projects: [], taskProjectLinks: {}, taskColorOverrides: {} });

  it("undoes the first space's writes when the second space write fails", async () => {
    const stores: Record<string, SpaceData> = { sp1: emptySpace(), sp2: emptySpace() };
    const writes = new Map([
      ["sp1", { links: { new1: { projectId: "p" } }, colors: { new1: "#fff" } }],
      ["sp2", { links: { new2: { projectId: "p" } }, colors: {} }],
    ]);
    const update = async (spaceId: string, mutate: (d: SpaceData) => SpaceData) => {
      if (spaceId === "sp2" && stores.sp2.taskProjectLinks.new2 === undefined && Object.keys(stores.sp1.taskProjectLinks).length > 0) {
        throw new Error("storage quota exceeded");
      }
      stores[spaceId] = mutate(stores[spaceId]);
    };

    await expect(
      commitMetadataAtomically(writes, new Set(["new1", "new2"]), update),
    ).rejects.toThrow("storage quota exceeded");

    expect(stores.sp1.taskProjectLinks).toEqual({});
    expect(stores.sp1.taskColorOverrides).toEqual({});
  });

  it("writes every space when nothing fails", async () => {
    const stores: Record<string, SpaceData> = { sp1: emptySpace() };
    await commitMetadataAtomically(
      new Map([["sp1", { links: { g: { projectId: "p" } }, colors: { g: "#abc" } }]]),
      new Set(["g"]),
      async (spaceId, mutate) => {
        stores[spaceId] = mutate(stores[spaceId]);
      },
    );
    expect(stores.sp1.taskProjectLinks).toEqual({ g: { projectId: "p" } });
    expect(stores.sp1.taskColorOverrides).toEqual({ g: "#abc" });
  });
});

describe("executeBulkDelete: restore after a partial successful delete", () => {
  it("does not move a child back under a parent that was already deleted", async () => {
    // Month > Week > Day(unselected). Week is selected, Month is selected. Deepest-first order is
    // [week, month]. Week deletes OK, then month delete fails. The day was moved out of the week
    // before the batch started; its original parent (the week) is now gone, so it must NOT be restored.
    const plan = planBulkDelete(["m", "w1"], tree);
    const store = makeStore(tree);
    const current = new Map(tree.map((g) => [g.id, g.parent_id]));
    const parents = new Map(tree.map((g) => [g.id, g.parent_id]));
    const restoreCalls: string[] = [];

    const outcome = await executeBulkDelete(
      plan,
      {
        reparent: async (goalId, parentId) => {
          if (parentId === "w1" && goalId === "d2") restoreCalls.push(goalId);
          current.set(goalId, parentId);
          store.alive.get(goalId)!.parent_id = parentId;
        },
        remove: async (goalId) => {
          if (goalId === "m") throw new Error("HTTP 503 on month");
          store.removeSubtree(goalId);
        },
      },
      parents,
    );

    expect(outcome.deleted).toEqual(["w1"]);
    expect(outcome.abortReason).toContain("Stopped after removal of m failed");
    // d2 must not be sent back to the deleted week.
    expect(restoreCalls).toEqual([]);
    expect(outcome.restoreSkipped.map((s) => s.goalId)).toContain("d2");
    expect(outcome.restoreSkipped.find((s) => s.goalId === "d2")!.reason).toContain("w1 was deleted");
    // Month is still alive, and d2 remains where the batch left it (under the top level, not the deleted week).
    expect(store.alive.has("m")).toBe(true);
    expect(store.alive.has("w1")).toBe(false);
  });

  it("still restores a child whose original parent survives the batch", async () => {
    const plan = planBulkDelete(["w1", "w2"], tree);
    const parents = new Map(tree.map((g) => [g.id, g.parent_id]));
    const moved: string[] = [];
    const outcome = await executeBulkDelete(
      plan,
      {
        reparent: async (goalId) => {
          moved.push(goalId);
        },
        remove: async (goalId) => {
          if (goalId === "w2") throw new Error("HTTP 500");
        },
      },
      parents,
    );
    // d1 and d2 were moved out of w1 (their original parent, which was deleted OK).
    // Restore is skipped for them because w1 was deleted; w2 failed so nothing else is skipped.
    expect(outcome.restoreSkipped.map((s) => s.goalId).sort()).toEqual(["d1", "d2"]);
    expect(outcome.deleted).toEqual(["w1"]);
  });
});

import { MetadataCleanupError } from "../src/shared/planning";

describe("commitMetadataAtomically: cleanup failure is reported, not swallowed", () => {
  it("throws MetadataCleanupError naming the space whose undo also failed", async () => {
    const stores: Record<string, SpaceData> = {
      sp1: { projects: [], taskProjectLinks: {}, taskColorOverrides: {} },
      sp2: { projects: [], taskProjectLinks: {}, taskColorOverrides: {} },
    };
    const writes = new Map([
      ["sp1", { links: { n1: { projectId: "p" } }, colors: {} }],
      ["sp2", { links: { n2: { projectId: "p" } }, colors: {} }],
    ]);
    // Call sequence: 1) write sp1 OK, 2) write sp2 fails, 3) undo sp1 fails.
    let call = 0;
    const update = async (spaceId: string, mutate: (d: SpaceData) => SpaceData) => {
      call++;
      if (call === 2) throw new Error("quota");
      if (call === 3) throw new Error("undo failed");
      stores[spaceId] = mutate(stores[spaceId]);
    };

    const err = await commitMetadataAtomically(writes, new Set(["n1", "n2"]), update).catch((e) => e);
    expect(err).toBeInstanceOf(MetadataCleanupError);
    expect(err.leftoverSpaces).toEqual(["sp1"]);
    expect(err.message).toContain("sp1");
    expect(err.message).toContain("quota");
    expect(call).toBe(3);
  });
});

describe("duplicate: storage failure after goals are created", () => {
  it("rolls back the created goals and reports the metadata cleanup problem", async () => {
    const remote = new Set<string>();
    const created = ["g1", "g2", "g3"];
    const stores: Record<string, SpaceData> = {
      sp1: { projects: [], taskProjectLinks: {}, taskColorOverrides: {} },
      sp2: { projects: [], taskProjectLinks: {}, taskColorOverrides: {} },
    };
    const writes = new Map([
      ["sp1", { links: { g1: { projectId: "p" } }, colors: {} }],
      ["sp2", { links: { g3: { projectId: "p" } }, colors: {} }],
    ]);
    let call = 0;
    const update = async (spaceId: string, mutate: (d: SpaceData) => SpaceData) => {
      call++;
      if (call === 2) throw new Error("storage quota exceeded");
      if (call === 3) throw new Error("undo failed");
      stores[spaceId] = mutate(stores[spaceId]);
    };

    const err = await withCreationRollback(
      async (track) => {
        for (const id of created) {
          await Promise.resolve();
          remote.add(id);
          track(id);
        }
        await commitMetadataAtomically(writes, new Set(created), update);
      },
      async (id) => {
        remote.delete(id);
      },
    ).catch((e) => e);

    // Created goals are rolled back on the remote side.
    expect(remote.size).toBe(0);
    expect(err).toBeInstanceOf(CreationAbortedError);
    // The cleanup failure is visible in the message, not hidden behind the storage error.
    expect(err.message).toContain("storage quota exceeded");
    expect(err.message).toContain("Could not undo metadata in space(s): sp1");
    expect(err.message).toContain("Rolled back 3 of 3");
  });
});
