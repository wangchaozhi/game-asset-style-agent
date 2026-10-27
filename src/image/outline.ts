import sharp from "sharp";
import { hexToRgb } from "./palette.js";

/** Pixels at least this opaque count as the subject when growing the outline. */
const SOLID = 128;

/**
 * Draw a uniform outer outline around the subject of a transparent image: every pixel within
 * `width` px of the subject (a round brush; square for pixel art, which keeps 1px corners crisp)
 * becomes `color`, and the original is drawn on top so anti-aliased edges blend into it.
 * The image keeps its size, so the outline is clipped at the canvas edge.
 */
export async function addOutline(data: Buffer, opts: { width: number; color: string; square?: boolean }): Promise<Buffer> {
  const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const r = Math.max(1, Math.min(16, Math.round(opts.width)));
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = raw[i * 4 + 3] >= SOLID ? 1 : 0;
  // Which pixels lie within the brush of the subject. Both are linear in the image size, so a wide
  // outline on a large image stays fast (a per-pixel brush scan blocked the server for seconds).
  const near = opts.square ? dilateSquare(solid, w, h, r) : withinDisc(solid, w, h, r);
  const [cr, cg, cb] = hexToRgb(opts.color);
  const out = Buffer.from(raw);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    // Any pixel that isn't fully opaque, including the subject's own soft edge, gets the outline behind it.
    if (raw[p + 3] === 255 || !near[i]) continue;
    const a = raw[p + 3] / 255;
    // Original over an opaque outline pixel.
    out[p] = Math.round(raw[p] * a + cr * (1 - a));
    out[p + 1] = Math.round(raw[p + 1] * a + cg * (1 - a));
    out[p + 2] = Math.round(raw[p + 2] * a + cb * (1 - a));
    out[p + 3] = 255;
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Square brush: a pixel is near when a solid pixel lies within r on both axes (separable sliding windows). */
function dilateSquare(solid: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const rows = new Uint8Array(w * h);
  const sum = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) sum[x + 1] = sum[x] + solid[y * w + x];
    for (let x = 0; x < w; x++) rows[y * w + x] = sum[Math.min(w, x + r + 1)] - sum[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) sum[y + 1] = sum[y] + rows[y * w + x];
    for (let y = 0; y < h; y++) out[y * w + x] = sum[Math.min(h, y + r + 1)] - sum[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return out;
}

/** Round brush: exact squared Euclidean distance to the subject (Felzenszwalb–Huttenlocher), near when ≤ r² + r. */
function withinDisc(solid: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const INF = 1e12;
  const d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = solid[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const out1 = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  /** 1-D squared distance transform of f[0..len) into out1. */
  const dt = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      out1[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    dt(h);
    for (let y = 0; y < h; y++) d[y * w + x] = out1[y];
  }
  const limit = r * r + r;
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    dt(w);
    for (let x = 0; x < w; x++) near[y * w + x] = out1[x] <= limit ? 1 : 0;
  }
  return near;
}

/** Default outline colour: the darkest palette colour, else near-black. */
export function darkestColor(palette: string[]): string {
  const lum = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return palette.length ? palette.reduce((a, b) => (lum(b) < lum(a) ? b : a)) : "#1a1a1a";
}
