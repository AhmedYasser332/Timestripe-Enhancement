import { describe, expect, it } from "vitest";
import { hexToRgbTriple, readableTextColor, rgbToHex, rgbTripleString } from "../src/shared/colors";

describe("Color Utilities & WCAG Contrast (PRD §35)", () => {
  describe("hexToRgbTriple", () => {
    it.each([
      { hex: "#000000", expected: [0, 0, 0] },
      { hex: "#FFFFFF", expected: [255, 255, 255] },
      { hex: "#7C5CFF", expected: [124, 92, 255] },
      { hex: "#FFF", expected: [255, 255, 255] },
      { hex: "00E676", expected: [0, 230, 118] },
    ])("converts $hex to RGB triplet", ({ hex, expected }) => {
      expect(hexToRgbTriple(hex)).toEqual(expected);
    });

    it("falls back to default neutral color on invalid hex", () => {
      expect(hexToRgbTriple("invalid")).toEqual([42, 42, 42]);
    });
  });

  describe("rgbToHex", () => {
    it.each([
      { r: 0, g: 0, b: 0, expected: "#000000" },
      { r: 255, g: 255, b: 255, expected: "#ffffff" },
      { r: 124, g: 92, b: 255, expected: "#7c5cff" },
    ])("converts ($r, $g, $b) to hex string", ({ r, g, b, expected }) => {
      expect(rgbToHex(r, g, b)).toBe(expected);
    });

    it("clamps values outside 0-255 bounds", () => {
      expect(rgbToHex(-10, 300, 128)).toBe("#00ff80");
    });
  });

  describe("readableTextColor", () => {
    it("returns dark text for light background", () => {
      // White background -> dark text
      expect(readableTextColor([255, 255, 255])).toEqual([30, 30, 32]);
    });

    it("returns light text for dark background", () => {
      // Pure black or dark purple -> Timestripe light text
      expect(readableTextColor([24, 24, 27])).toEqual([236, 237, 239]);
    });
  });

  describe("rgbTripleString", () => {
    it("formats triplet for CSS variables", () => {
      expect(rgbTripleString([124, 92, 255])).toBe("124, 92, 255");
    });
  });
});
