/**
 * Generates the extension logo in all required sizes (16/32/48/128) as PNGs,
 * pure JS via pngjs. Design: dark rounded square, a 3-segment timeline stripe
 * in Timestripe's native palette (yellow/green/blue) and a white playhead dot.
 * Run: node scripts/make-icons.mjs
 */

import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "icons");

const MASTER = 256;
const SS = 3; // supersampling factor per axis

// ---------- SDF helpers ----------

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** signed distance to a rounded rect centered (cx,cy) with half-sizes (hx,hy) and radius r */
function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function mix(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(c1, c2, t) {
  return [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
}

// ---------- scene ----------

const BG_TOP = [34, 34, 36];
const BG_BOTTOM = [20, 20, 22];
const YELLOW = [236, 206, 50];
const GREEN = [146, 206, 20];
const BLUE = [39, 141, 234];

/** color at pixel (x,y) in MASTER-space, or null when outside the rounded square */
function scene(x, y) {
  const S = MASTER;
  const corner = S * 0.22;
  // rounded-square background with subtle vertical gradient
  const d = sdRoundRect(x, y, S / 2, S / 2, S / 2, S / 2, corner);
  if (d > 0.5) return null;
  const bg = mixColor(BG_TOP, BG_BOTTOM, y / S);

  // timeline stripe: 3 segments with rounded ends, slight inset from edges
  const barH = S * 0.1;
  const barY = S * 0.62;
  const left = S * 0.18;
  const right = S * 0.82;
  const seg1End = mix(left, right, 0.4);
  const seg2End = mix(left, right, 0.66);
  const r = barH / 2;

  const segs = [
    [left, seg1End, YELLOW],
    [seg1End, seg2End, GREEN],
    [seg2End, right, BLUE],
  ];

  let color = bg;
  for (const [x0, x1, c] of segs) {
    // each segment: rounded rect that overlaps neighbors slightly to avoid seams
    const dist = sdRoundRect(x, y, (x0 + x1) / 2, barY, (x1 - x0) / 2 + 0.75, r, r);
    if (dist < 0.5) color = c;
  }

  // playhead dot at the green→blue boundary
  if (sdCircle(x, y, seg2End, barY, S * 0.052) < 0.5) {
    color = [244, 245, 246];
  }

  // soften the square edge
  const alpha = clamp01(0.5 - d);
  return [...color, alpha];
}

// ---------- render ----------

function renderMaster() {
  const png = new PNG({ width: MASTER, height: MASTER });
  for (let py = 0; py < MASTER; py++) {
    for (let px = 0; px < MASTER; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const sample = scene(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS);
          if (!sample) continue;
          r += sample[0];
          g += sample[1];
          b += sample[2];
          a += sample[3];
        }
      }
      const n = SS * SS;
      const idx = (MASTER * py + px) << 2;
      if (a > 0) {
        png.data[idx] = Math.round(r / a);
        png.data[idx + 1] = Math.round(g / a);
        png.data[idx + 2] = Math.round(b / a);
        png.data[idx + 3] = Math.round((a / n) * 255);
      } else {
        png.data[idx + 3] = 0;
      }
    }
  }
  return png;
}

function downscale(src, target) {
  const out = new PNG({ width: target, height: target });
  const scale = MASTER / target;
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = Math.floor(y * scale); sy < Math.floor((y + 1) * scale); sy++) {
        for (let sx = Math.floor(x * scale); sx < Math.floor((x + 1) * scale); sx++) {
          const idx = (MASTER * sy + sx) << 2;
          const alpha = src.data[idx + 3] / 255;
          r += src.data[idx] * alpha;
          g += src.data[idx + 1] * alpha;
          b += src.data[idx + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const idx = (target * y + x) << 2;
      if (a > 0) {
        out.data[idx] = Math.round(r / a);
        out.data[idx + 1] = Math.round(g / a);
        out.data[idx + 2] = Math.round(b / a);
        out.data[idx + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
const master = renderMaster();
for (const size of [128, 48, 32, 16]) {
  const png = size === MASTER ? master : downscale(master, size);
  writeFileSync(join(OUT, `icon${size}.png`), PNG.sync.write(png));
  console.log(`wrote public/icons/icon${size}.png`);
}
