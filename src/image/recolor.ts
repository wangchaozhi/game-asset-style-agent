import sharp from "sharp";
import { deltaE, hexToRgb, rgbToLab } from "./palette.js";

type Lab = [number, number, number];

const linearToSrgb = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** CIELAB (D65) → sRGB 0-255, clamped. Inverse of rgbToLab. */
export function labToRgb([L, a, b]: Lab): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const [x, y, z] = [inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883];
  const R = x * 3.2404542 - y * 1.5371385 - z * 0.4985314;
  const G = -x * 0.969266 + y * 1.8760108 + z * 0.041556;
  const B = x * 0.0556434 - y * 0.2040259 + z * 1.0572252;
  return [clamp(linearToSrgb(R)), clamp(linearToSrgb(G)), clamp(linearToSrgb(B))];
}

const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");

/**
 * The main colours of an image's visible pixels: a coarse histogram, merged greedily so shades
 * closer than `merge` ΔE fold into the more common colour. Returns up to `max` colours with their share.
 */
export async function dominantColors(data: Buffer, opts: { max?: number; merge?: number } = {}): Promise<{ hex: string; share: number }[]> {
  const { data: px } = await sharp(data)
    .ensureAlpha()
    .resize(128, 128, { fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.nearest })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    total++;
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    const b = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    b.r += px[i];
    b.g += px[i + 1];
    b.b += px[i + 2];
    b.n++;
    buckets.set(key, b);
  }
  const clusters: { lab: Lab; r: number; g: number; b: number; n: number }[] = [];
  for (const b of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const [r, g, bl] = [b.r / b.n, b.g / b.n, b.b / b.n];
    const lab = rgbToLab(r, g, bl);
    const near = clusters.find((c) => deltaE(c.lab, lab) < (opts.merge ?? 12));
    if (near) near.n += b.n;
    else clusters.push({ lab, r, g, b: bl, n: b.n });
  }
  return clusters
    .sort((x, y) => y.n - x.n)
    .slice(0, opts.max ?? 8)
    .map((c) => ({ hex: toHex(c.r, c.g, c.b), share: Math.round((c.n / Math.max(1, total)) * 1000) / 1000 }))
    .filter((c) => c.share >= 0.01);
}

export interface ColorSwap {
  from: string;
  to: string;
}

/**
 * Swap colours while keeping shading: each visible pixel within `threshold` ΔE of a `from` colour
 * (the nearest one wins) moves by the same Lab offset that takes `from` to `to`, so highlights and
 * shadows of the old colour become highlights and shadows of the new one. Other pixels and alpha stay.
 */
export async function recolor(data: Buffer, swaps: ColorSwap[], threshold = 20): Promise<Buffer> {
  const { data: px, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const map = swaps.map((s) => {
    const from = rgbToLab(...hexToRgb(s.from));
    const to = rgbToLab(...hexToRgb(s.to));
    return { from, shift: [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as Lab };
  });
  const cache = new Map<number, [number, number, number] | null>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let hit = cache.get(key);
    if (hit === undefined) {
      const lab = rgbToLab(px[i], px[i + 1], px[i + 2]);
      let best: (typeof map)[number] | null = null;
      let bestD = threshold;
      for (const m of map) {
        const d = deltaE(lab, m.from);
        if (d <= bestD) [best, bestD] = [m, d];
      }
      hit = best ? labToRgb([lab[0] + best.shift[0], lab[1] + best.shift[1], lab[2] + best.shift[2]]) : null;
      cache.set(key, hit);
    }
    if (hit) [px[i], px[i + 1], px[i + 2]] = hit;
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
