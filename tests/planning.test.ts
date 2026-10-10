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

  it("reports a mid-run delete failure without claiming the failed goal was deleted", async () => {
    const plan = planBulkDelete(["d1", "w2"], tree);
    const outcome = await executeBulkDelete(plan, {
      reparent: async () => {},
      remove: async (id) => {
        if (id === "d1") throw new Error("HTTP 503");
      },
    });
    expect(outcome.deleted).toEqual(["w2"]);
    expect(outcome.failed.map((f) => f.goalId)).toEqual(["d1"]);
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
