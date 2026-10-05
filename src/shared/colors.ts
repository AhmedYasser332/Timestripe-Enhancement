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
