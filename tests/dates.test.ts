import { describe, expect, it } from "vitest";
import { addDays, computeDayOffset } from "../src/shared/dates";

describe("Date Utilities & Relative Offsets (PRD §22, §25)", () => {
  describe("addDays", () => {
    it.each([
      { input: "2026-10-04", days: 1, expected: "2026-10-05", label: "same month increment" },
      { input: "2026-10-31", days: 1, expected: "2026-11-01", label: "month boundary rollover" },
      { input: "2026-12-31", days: 1, expected: "2027-01-01", label: "year boundary rollover" },
      { input: "2026-10-04", days: -3, expected: "2026-10-01", label: "negative day decrement" },
      { input: "2026-03-01", days: -1, expected: "2026-02-28", label: "leap/non-leap Feb handling (2026 is non-leap)" },
      { input: "2024-03-01", days: -1, expected: "2024-02-29", label: "leap year Feb 29 handling (2024 is leap year)" },
      { input: "2026-10-10", days: 0, expected: "2026-10-10", label: "zero offset identity" },
    ])("correctly shifts date: $label", ({ input, days, expected }) => {
      expect(addDays(input, days)).toBe(expected);
    });

    it("returns invalid date input unchanged safely", () => {
      expect(addDays("invalid-date", 5)).toBe("invalid-date");
    });
  });

  describe("computeDayOffset", () => {
    it.each([
      { source: "2026-10-10", target: "2026-10-10", expected: 0, label: "same date" },
      { source: "2026-10-10", target: "2026-10-13", expected: 3, label: "+3 days" },
      { source: "2026-10-13", target: "2026-10-10", expected: -3, label: "-3 days" },
      { source: "2026-10-25", target: "2026-11-05", expected: 11, label: "across month boundary" },
      { source: "2026-12-30", target: "2027-01-05", expected: 6, label: "across year boundary" },
    ])("calculates exact signed integer offset: $label", ({ source, target, expected }) => {
      expect(computeDayOffset(source, target)).toBe(expected);
    });

    it("returns 0 for malformed date string", () => {
      expect(computeDayOffset("bad", "2026-10-10")).toBe(0);
    });
  });
});
