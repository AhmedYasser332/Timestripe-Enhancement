/** Color helpers — hex/rgb conversion and readable text contrast (PRD §35). */

export function hexToRgbTriple(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int) || full.length !== 6) return [42, 42, 42];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Relative luminance (WCAG-ish, simplified). */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Readable foreground for a background color. Light backgrounds get dark text,
 * dark backgrounds get Timestripe's light text (236, 237, 239 from their dark theme).
 */
export function readableTextColor(rgb: [number, number, number]): [number, number, number] {
  return luminance(rgb) > 0.45 ? [30, 30, 32] : [236, 237, 239];
}

/** "R, G, B" triplet string as Timestripe's CSS variables expect. */
export function rgbTripleString(rgb: [number, number, number]): string {
  return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
}

/**
 * Rich picker rows, modeled on Timestripe's own color picker
 * (neutrals → vivid → pastels → deep → native). Shared by the popup and the
 * in-page dashboard so both offer the exact same palette.
 */
export const PALETTE_ROWS: string[][] = [
  ["#FFFFFF", "#EBEBEB", "#D6D6D6", "#BDBDBD", "#A3A3A3", "#8A8A8A", "#707070", "#575757", "#3D3D3D", "#262626"],
  ["#F000F0", "#9013FE", "#2D2DE8", "#00A8FF", "#00E676", "#AEEA00", "#FFEA00", "#FF9100", "#FF3D00", "#C62828"],
  ["#F8BBD0", "#F48FB1", "#EC9BB6", "#E1BEE7", "#CE93D8", "#B39DDB", "#9FA8DA", "#90CAF9", "#81D4FA", "#4FC3F7"],
  ["#B2EBF2", "#80CBC4", "#A5D6A7", "#C5E1A5", "#E6EE9C", "#FFF59D", "#FFE082", "#FFCC80", "#FFAB91", "#FF8A65"],
  ["#880E4F", "#4A148C", "#311B92", "#01579B", "#0277BD", "#00695C", "#1B5E20", "#827717", "#E65100", "#BF360C"],
  ["#DF496D", "#955BE0", "#278DEA", "#23B5A8", "#92CE14", "#ECCE32", "#F2713A", "#FFFFFF", "#000000"],
];
