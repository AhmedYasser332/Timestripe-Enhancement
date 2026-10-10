import { describe, expect, it } from "vitest";
import { resolveAssignments } from "../src/shared/inheritance";

describe("Inheritance Resolution Engine (PRD §7)", () => {
  it("resolves explicit project assignment on a standalone goal", () => {
    const parents = { g1: null };
    const links = { g1: { projectId: "p-quran" } };

    const resolved = resolveAssignments(parents, links);
    expect(resolved.g1).toEqual({
      projectId: "p-quran",
      source: "explicit",
    });
  });

  it("propagates project from parent to child through inheritance", () => {
    const parents = {
      parent: null,
      child: "parent",
    };
    const links = {
      parent: { projectId: "p-work" },
    };

    const resolved = resolveAssignments(parents, links);
    expect(resolved.parent).toEqual({ projectId: "p-work", source: "explicit" });
    expect(resolved.child).toEqual({ projectId: "p-work", source: "inherited" });
  });

  it("propagates project across multi-level deep hierarchy (Month -> Week -> Day)", () => {
    const parents = {
      month: null,
      week: "month",
      day: "week",
      task: "day",
    };
    const links = {
      month: { projectId: "p-study" },
    };

    const resolved = resolveAssignments(parents, links);
    expect(resolved.month).toEqual({ projectId: "p-study", source: "explicit" });
    expect(resolved.week).toEqual({ projectId: "p-study", source: "inherited" });
    expect(resolved.day).toEqual({ projectId: "p-study", source: "inherited" });
    expect(resolved.task).toEqual({ projectId: "p-study", source: "inherited" });
  });

  it("allows explicit child link to override parent project", () => {
    const parents = {
      parent: null,
      child: "parent",
    };
    const links = {
      parent: { projectId: "p-parent" },
      child: { projectId: "p-child-override" },
    };

    const resolved = resolveAssignments(parents, links);
    expect(resolved.parent.projectId).toBe("p-parent");
    expect(resolved.child).toEqual({
      projectId: "p-child-override",
      source: "explicit",
    });
  });

  it("handles cyclical references safely without infinite recursion", () => {
    const parents = {
      a: "b",
      b: "a",
    };
    const links = {};

    // Should not crash or hang
    const resolved = resolveAssignments(parents, links);
    expect(resolved).toEqual({});
  });

  it("returns nothing for unlinked, unparented goals", () => {
    const parents = { unassigned: null };
    const links = {};

    const resolved = resolveAssignments(parents, links);
    expect(resolved.unassigned).toBeUndefined();
  });

  it("explicit 'No Project' (__none__) prevents inheritance from parent", () => {
    const parents = {
      parent: null,
      child: "parent",
    };
    const links = {
      parent: { projectId: "p-quran" },
      child: { projectId: "__none__" },
    };

    const resolved = resolveAssignments(parents, links);
    expect(resolved.parent).toEqual({ projectId: "p-quran", source: "explicit" });
    // child explicitly chose "No project", so it must NOT inherit "p-quran"
    expect(resolved.child).toBeUndefined();
  });

  it("removing explicit link allows child to inherit from parent again", () => {
    const parents = {
      parent: null,
      child: "parent",
    };
    // child has no link entry
    const links = {
      parent: { projectId: "p-quran" },
    };

    const resolved = resolveAssignments(parents, links);
    expect(resolved.child).toEqual({ projectId: "p-quran", source: "inherited" });
  });
});
