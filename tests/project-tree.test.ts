import { describe, expect, it } from "vitest";
import {
  buildProjectTree,
  descendantsOf,
  effectiveColor,
  flattenTree,
  isDescendant,
  projectPath,
  reorderProjectTree,
  subtreeTaskCount,
} from "../src/shared/project-tree";
import type { Project } from "../src/shared/types";

function proj(id: string, name: string, color: string, parentId: string | null = null): Project {
  return {
    id,
    name,
    color,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    archived: false,
    spaceId: null,
    parentId,
  };
}

const TREE = [
  proj("seek", "طلب علم", "#00A8FF"),
  proj("fiqh", "فقه", "", "seek"),
  proj("aqida", "عقيدة", "#FF3D00", "seek"),
  proj("shafii", "شافعي", "", "fiqh"),
  proj("work", "Work", "#00E676"),
];

describe("Project Tree (sub-projects)", () => {
  describe("buildProjectTree + flattenTree", () => {
    it("nests children under parents with correct depths", () => {
      const tree = buildProjectTree(TREE);
      expect(tree).toHaveLength(2); // seek + work are roots
      const seek = tree.find((n) => n.project.id === "seek")!;
      expect(seek.depth).toBe(0);
      expect(seek.children.map((c) => c.project.id).sort()).toEqual(["aqida", "fiqh"]);

      const flat = flattenTree(tree);
      const fiqh = flat.find((n) => n.project.id === "fiqh")!;
      expect(fiqh.depth).toBe(1);
      const shafii = flat.find((n) => n.project.id === "shafii")!;
      expect(shafii.depth).toBe(2);
    });

    it("surfaces orphans (missing parent) as roots", () => {
      const orphaned = [proj("a", "A", "#111111", "ghost")];
      const tree = buildProjectTree(orphaned);
      expect(tree).toHaveLength(1);
      expect(tree[0].project.id).toBe("a");
    });
  });

  describe("effectiveColor inheritance", () => {
    it("sub without its own color walks up to the nearest ancestor color", () => {
      expect(effectiveColor(TREE, "fiqh")).toBe("#00A8FF"); // inherits from seek
      expect(effectiveColor(TREE, "shafii")).toBe("#00A8FF"); // two levels up
      expect(effectiveColor(TREE, "aqida")).toBe("#FF3D00"); // own color wins
      expect(effectiveColor(TREE, "work")).toBe("#00E676");
    });

    it("falls back to a neutral color when the whole chain is colorless", () => {
      const chain = [proj("p", "P", ""), proj("c", "C", "", "p")];
      expect(effectiveColor(chain, "c")).toMatch(/^#[0-9a-f]{6}$/i);
      expect(effectiveColor(chain, "c")).not.toBe("");
    });

    it("follows dynamic parent recolors (no stored color on the sub)", () => {
      const dynamic = [proj("seek", "طلب علم", "#00A8FF"), proj("fiqh", "فقه", "", "seek")];
      expect(effectiveColor(dynamic, "fiqh")).toBe("#00A8FF");
      dynamic[0].color = "#FF9100";
      expect(effectiveColor(dynamic, "fiqh")).toBe("#FF9100");
    });
  });

  describe("descendantsOf / isDescendant", () => {
    it("collects the whole subtree breadth-first", () => {
      const ids = descendantsOf(TREE, "seek").map((p) => p.id);
      expect(ids).toEqual(["fiqh", "aqida", "shafii"]);
    });

    it("detects descendants across levels and excludes self", () => {
      expect(isDescendant(TREE, "seek", "shafii")).toBe(true);
      expect(isDescendant(TREE, "seek", "work")).toBe(false);
      expect(isDescendant(TREE, "fiqh", "fiqh")).toBe(false);
    });
  });

  describe("projectPath", () => {
    it("returns root → … → self chain", () => {
      const names = projectPath(TREE, "shafii").map((p) => p.name);
      expect(names).toEqual(["طلب علم", "فقه", "شافعي"]);
    });

    it("handles orphaned parentId without crashing", () => {
      const path = projectPath([proj("a", "A", "#111111", "ghost")], "a");
      expect(path.map((p) => p.id)).toEqual(["a"]);
    });
  });

  describe("subtreeTaskCount", () => {
    it("sums direct counts across the whole subtree", () => {
      const counts = new Map<string, number>([
        ["seek", 2],
        ["fiqh", 3],
        ["shafii", 4],
        ["work", 5],
      ]);
      expect(subtreeTaskCount(TREE, "seek", counts)).toBe(9); // 2 + 3 + 4 (aqida has none)
      expect(subtreeTaskCount(TREE, "work", counts)).toBe(5);
      expect(subtreeTaskCount(TREE, "aqida", counts)).toBe(0);
    });
  });

  describe("reorderProjectTree", () => {
    it("moves parent project together with all its children and descendants", () => {
      // TREE is: seek (with children fiqh -> shafii, aqida), work
      // If we move seek to after work:
      // seek and all its descendants (fiqh, aqida, shafii) must move after work!
      const reordered = reorderProjectTree(TREE, "seek", "work", "after");
      const ids = reordered.map((p) => p.id);
      expect(ids).toEqual(["work", "seek", "fiqh", "aqida", "shafii"]);
    });

    it("prevents dropping a parent into one of its own descendants", () => {
      // Attempting to move seek into its descendant fiqh or shafii must be rejected
      const attempt1 = reorderProjectTree(TREE, "seek", "fiqh", "before");
      expect(attempt1).toBe(TREE);

      const attempt2 = reorderProjectTree(TREE, "seek", "shafii", "after");
      expect(attempt2).toBe(TREE);
    });

    it("reorders siblings cleanly before or after", () => {
      // Move work before seek
      const reordered = reorderProjectTree(TREE, "work", "seek", "before");
      const ids = reordered.map((p) => p.id);
      expect(ids).toEqual(["work", "seek", "fiqh", "aqida", "shafii"]);
    });
  });
});
