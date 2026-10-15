import sharp from "sharp";

export interface PaletteReport {
  /** share of opaque pixels within `threshold` ΔE of some palette colour, 0-1 */
  coverage: number;
  /** mean ΔE (CIE76) from each opaque pixel to its nearest palette colour */
  meanDeltaE: number;
  threshold: number;
  /** share of opaque pixels assigned to each palette colour (nearest match, in palette order) */
  usage: { hex: string; share: number }[];
  /** the most common colours that are not close to any palette colour */
  offPalette: { hex: string; share: number }[];
  /** opaque pixels sampled */
  pixels: number;
}

type Lab = [number, number, number];

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** sRGB (0-255) → CIELAB (D65). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const [R, G, B] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * How closely an image sticks to a palette. Transparent pixels are ignored, the image is
 * sampled at up to `sampleSize` px per side, and colour distance is ΔE in Lab space.
 * Shading and anti-aliasing legitimately create in-between colours, so read coverage as a
 * drift signal (e.g. a sudden drop vs. sibling assets), not as pass/fail.
 */
export async function analyzePalette(data: Buffer, palette: string[], opts: { threshold?: number; sampleSize?: number } = {}): Promise<PaletteReport> {
  const threshold = opts.threshold ?? 20;
  const size = opts.sampleSize ?? 128;
  const { data: px, info } = await sharp(data)
    .ensureAlpha()
    .resize(size, size, { fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.nearest })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pal = palette.map((h) => ({ hex: h.toLowerCase(), lab: rgbToLab(...hexToRgb(h)) }));
  const used = new Array(pal.length).fill(0);
  // Off-palette pixels are bucketed at 4 bits per channel, keeping the colour sum for an average.
  const off = new Map<number, { n: number; r: number; g: number; b: number }>();
  const cache = new Map<number, [number, number]>();
  let pixels = 0;
  let close = 0;
  let sumDE = 0;

  for (let i = 0; i < px.length; i += info.channels) {
    if (px[i + 3] < 128) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    pixels++;
    const key = (r << 16) | (g << 8) | b;
    let hit = cache.get(key);
    if (!hit) {
      const lab = rgbToLab(r, g, b);
      let best = 0;
      let bestDE = Infinity;
      pal.forEach((p, j) => {
        const d = deltaE(lab, p.lab);
        if (d < bestDE) [best, bestDE] = [j, d];
      });
      hit = [best, bestDE];
      cache.set(key, hit);
    }
    const [j, d] = hit;
    if (pal.length) used[j]++;
    sumDE += d;
    if (d <= threshold) close++;
    else {
      const bucket = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const o = off.get(bucket) ?? { n: 0, r: 0, g: 0, b: 0 };
      o.n++;
      o.r += r;
      o.g += g;
      o.b += b;
      off.set(bucket, o);
    }
  }

  const share = (n: number) => (pixels ? round(n / pixels) : 0);
  return {
    coverage: pal.length ? share(close) : 0,
    meanDeltaE: pixels && pal.length ? round(sumDE / pixels, 1) : 0,
    threshold,
    usage: pal.map((p, j) => ({ hex: p.hex, share: share(used[j]) })),
    offPalette: [...off.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
      .filter((o) => o.n / pixels >= 0.01)
      .map((o) => ({ hex: toHex(o.r / o.n, o.g / o.n, o.b / o.n), share: share(o.n) })),
    pixels,
  };
}

export type PaletteSummary = Pick<PaletteReport, "coverage" | "meanDeltaE" | "offPalette">;

/** One line for Claude's tool result. */
export function describePalette(r: PaletteSummary, threshold = 20): string {
  const off = r.offPalette.length
    ? `; main off-palette colours: ${r.offPalette.map((o) => `${o.hex} (${Math.round(o.share * 100)}%)`).join(", ")}`
    : "";
  return `Palette check: ${Math.round(r.coverage * 100)}% of opaque pixels within ΔE ${threshold} of the style palette (mean ΔE ${r.meanDeltaE})${off}. Shading/anti-aliasing adds some in-between colours; treat a low score as a drift hint and confirm by eye; for flat or pixel-art styles snap_to_palette can fix it.`;
}

/** 4×4 Bayer matrix, values 0..15. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Map every visible pixel to its nearest palette colour (ΔE in Lab), keeping alpha.
 * "ordered" dithering alternates between the two nearest colours in a Bayer pattern, weighted by
 * how close each is, which keeps the impression of gradients that pure snapping would band.
 */
export async function snapToPalette(data: Buffer, palette: string[], opts: { dither?: "none" | "ordered" } = {}): Promise<Buffer> {
  if (!palette.length) throw new Error("色板为空");
  const { data: px, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pal = palette.map((h) => ({ rgb: hexToRgb(h), lab: rgbToLab(...hexToRgb(h)) }));
  const cache = new Map<number, [number, number, number]>(); // rgb → [nearest, second, ratio×1000]
  const dither = opts.dither === "ordered" && pal.length > 1;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    if (px[i + 3] === 0) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let hit = cache.get(key);
    if (!hit) {
      const lab = rgbToLab(px[i], px[i + 1], px[i + 2]);
      let a = 0, b = 0, da = Infinity, db = Infinity;
      pal.forEach((c, j) => {
        const d = deltaE(lab, c.lab);
        if (d < da) [b, db, a, da] = [a, da, j, d];
        else if (d < db) [b, db] = [j, d];
      });
      hit = [a, b, da + db > 0 ? Math.round((da / (da + db)) * 1000) : 0];
      cache.set(key, hit);
    }
    let pick = hit[0];
    if (dither) {
      const x = p % info.width;
      const y = (p / info.width) | 0;
      // The further the pixel is from its nearest colour, the more often the second one shows.
      if ((BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < hit[2] / 1000) pick = hit[1];
    }
    const [r, g, b] = pal[pick].rgb;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
