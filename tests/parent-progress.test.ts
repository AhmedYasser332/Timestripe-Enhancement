import { describe, expect, it } from "vitest";

/** Pure logic for computing progress fraction for a parent goal. */
export function computeParentProgressNote(doneCount: number, total: number): string | null {
  if (total <= 0 || doneCount <= 0) return null;
  return `${doneCount}/${total}`;
}

/** Pure logic for optimistic progress note transition on client click. */
export function computeOptimisticNextNote(
  existingNote: string | null | undefined,
  delta: 1 | -1,
  totalHint?: number | null,
): string | null {
  let done = 0;
  let total = totalHint ?? null;

  if (existingNote) {
    const m = existingNote.match(/^(\d+)\/(\d+)$/);
    if (m) {
      done = parseInt(m[1], 10);
      if (!total || total <= 0) {
        total = parseInt(m[2], 10);
      }
    }
  }

  if (!total || total <= 0) return null;

  const nextDone = Math.max(0, Math.min(total, done + delta));
  return nextDone === 0 ? null : `${nextDone}/${total}`;
}

describe("computeParentProgressNote: authoritative fraction", () => {
  it("returns null when 0 subgoals are done (cleans badge)", () => {
    expect(computeParentProgressNote(0, 7)).toBeNull();
  });

  it("returns fraction when partially done", () => {
    expect(computeParentProgressNote(1, 7)).toBe("1/7");
    expect(computeParentProgressNote(2, 7)).toBe("2/7");
    expect(computeParentProgressNote(5, 7)).toBe("5/7");
  });

  it("returns N/N when all subgoals are done", () => {
    expect(computeParentProgressNote(7, 7)).toBe("7/7");
  });

  it("handles non-positive total gracefully", () => {
    expect(computeParentProgressNote(0, 0)).toBeNull();
    expect(computeParentProgressNote(1, 0)).toBeNull();
  });
});

describe("computeOptimisticNextNote: 0ms client transitions", () => {
  it("transitions from no badge to 1/7 when first subgoal is checked with total hint", () => {
    expect(computeOptimisticNextNote(null, 1, 7)).toBe("1/7");
    expect(computeOptimisticNextNote(undefined, 1, 7)).toBe("1/7");
  });

  it("increments fraction from 1/7 to 2/7", () => {
    expect(computeOptimisticNextNote("1/7", 1)).toBe("2/7");
    expect(computeOptimisticNextNote("2/7", 1)).toBe("3/7");
  });

  it("clamps at total (cannot exceed 7/7)", () => {
    expect(computeOptimisticNextNote("7/7", 1)).toBe("7/7");
  });

  it("decrements fraction on uncheck from 2/7 to 1/7", () => {
    expect(computeOptimisticNextNote("2/7", -1)).toBe("1/7");
  });

  it("clears badge to null when decremented to 0", () => {
    expect(computeOptimisticNextNote("1/7", -1)).toBeNull();
  });

  it("stays null when already 0 and decremented", () => {
    expect(computeOptimisticNextNote(null, -1, 7)).toBeNull();
  });
});

describe("Multi-tier subgoals progress simulation", () => {
  interface SimGoal {
    id: string;
    parentId: string | null;
    checked: boolean;
  }

  it("propagates Day subgoals to Week, and completed Week to Month", () => {
    // 1 Month -> 2 Weeks (w1, w2)
    // w1 -> 3 Days (d1, d2, d3)
    // w2 -> 2 Days (d4, d5)
    const goals: SimGoal[] = [
      { id: "m", parentId: null, checked: false },
      { id: "w1", parentId: "m", checked: false },
      { id: "w2", parentId: "m", checked: false },
      { id: "d1", parentId: "w1", checked: false },
      { id: "d2", parentId: "w1", checked: false },
      { id: "d3", parentId: "w1", checked: false },
      { id: "d4", parentId: "w2", checked: false },
      { id: "d5", parentId: "w2", checked: false },
    ];

    function evaluateTree(activeCheckedId: string, isChecked: boolean) {
      const byId = new Map(goals.map((g) => [g.id, g]));
      const g = byId.get(activeCheckedId)!;
      g.checked = isChecked;

      const childrenOf = (pid: string) => goals.filter((x) => x.parentId === pid);

      const isDone = (target: SimGoal): boolean => {
        if (target.id === activeCheckedId) return isChecked;
        if (target.checked) return true;
        const kids = childrenOf(target.id);
        if (kids.length > 0) return kids.every((k) => isDone(k));
        return false;
      };

      const w1Kids = childrenOf("w1");
      const w1Done = w1Kids.filter(isDone).length;
      const w1Note = computeParentProgressNote(w1Done, w1Kids.length);

      const mKids = childrenOf("m");
      const mDone = mKids.filter(isDone).length;
      const mNote = computeParentProgressNote(mDone, mKids.length);

      return { w1Note, mNote };
    }

    // Check d1: w1 gets 1/3, m gets null (w1 not complete)
    const step1 = evaluateTree("d1", true);
    expect(step1.w1Note).toBe("1/3");
    expect(step1.mNote).toBeNull();

    // Check d2: w1 gets 2/3, m gets null
    const step2 = evaluateTree("d2", true);
    expect(step2.w1Note).toBe("2/3");
    expect(step2.mNote).toBeNull();

    // Check d3 (all w1 complete!): w1 gets 3/3, w1 is complete, so m gets 1/2!
    const step3 = evaluateTree("d3", true);
    expect(step3.w1Note).toBe("3/3");
    expect(step3.mNote).toBe("1/2");

    // Uncheck d3: w1 drops to 2/3, m drops to null (0/2)
    const step4 = evaluateTree("d3", false);
    expect(step4.w1Note).toBe("2/3");
    expect(step4.mNote).toBeNull();

    // Uncheck d2 then d1: w1 drops to 1/3 then null
    evaluateTree("d2", false);
    const step6 = evaluateTree("d1", false);
    expect(step6.w1Note).toBeNull();
    expect(step6.mNote).toBeNull();
  });
});
