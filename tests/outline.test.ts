import { describe, expect, it } from "vitest";
import { flattenOutlineTree, parseOutlineLine, parseTextOutline } from "../src/shared/outline";

describe("Hierarchical Outline Parser (PRD §20, §49)", () => {
  describe("parseOutlineLine", () => {
    it("parses root item with no indentation", () => {
      const parsed = parseOutlineLine("Backend Learning [month]");
      expect(parsed).toEqual({
        name: "Backend Learning",
        depth: 0,
        horizon: "month",
      });
    });

    it("parses indented line with bullets and horizon tag", () => {
      const parsed = parseOutlineLine("  - Week 1: Databases [week]");
      expect(parsed).toEqual({
        name: "Week 1: Databases",
        depth: 1,
        horizon: "week",
      });
    });

    it("parses nested day task with numbers and tabs", () => {
      const parsed = parseOutlineLine("\t\t1. Setup Postgres [day]");
      expect(parsed).toEqual({
        name: "Setup Postgres",
        depth: 2,
        horizon: "day",
      });
    });

    it("returns null for empty or whitespace-only lines", () => {
      expect(parseOutlineLine("   ")).toBeNull();
      expect(parseOutlineLine("")).toBeNull();
    });
  });

  describe("parseTextOutline", () => {
    it("builds a nested parent-child tree from indented text", () => {
      const input = `
Month 1 [month]
  Week 1 [week]
    Day 1 Task [day]
    Day 2 Task [day]
  Week 2 [week]
    Day 3 Task [day]
      `;

      const tree = parseTextOutline(input);
      expect(tree).toHaveLength(1);

      const month = tree[0];
      expect(month.name).toBe("Month 1");
      expect(month.horizon).toBe("month");
      expect(month.children).toHaveLength(2);

      const week1 = month.children[0];
      expect(week1.name).toBe("Week 1");
      expect(week1.horizon).toBe("week");
      expect(week1.children).toHaveLength(2);
      expect(week1.children[0].name).toBe("Day 1 Task");
      expect(week1.children[0].horizon).toBe("day");

      const week2 = month.children[1];
      expect(week2.name).toBe("Week 2");
      expect(week2.children).toHaveLength(1);
    });

    it("handles multiple root items at depth 0", () => {
      const input = `
Project A
  Task A1
Project B
  Task B1
      `;
      const tree = parseTextOutline(input);
      expect(tree).toHaveLength(2);
      expect(tree[0].name).toBe("Project A");
      expect(tree[0].children).toHaveLength(1);
      expect(tree[1].name).toBe("Project B");
      expect(tree[1].children).toHaveLength(1);
    });
  });

  describe("flattenOutlineTree", () => {
    it("flattens tree into parent-referenced sequential list for API creation", () => {
      const input = `
Quran Goal [month]
  Surah Al-Baqarah [week]
    Ayat 1-50 [day]
      `;
      const tree = parseTextOutline(input);
      const flat = flattenOutlineTree(tree);

      expect(flat).toHaveLength(3);
      expect(flat[0].name).toBe("Quran Goal");
      expect(flat[0].parentTempId).toBeNull();

      expect(flat[1].name).toBe("Surah Al-Baqarah");
      expect(flat[1].parentTempId).toBe(flat[0].tempId);

      expect(flat[2].name).toBe("Ayat 1-50");
      expect(flat[2].parentTempId).toBe(flat[1].tempId);
    });
  });
});
