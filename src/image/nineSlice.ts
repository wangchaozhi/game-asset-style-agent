import sharp, { type OverlayOptions } from "sharp";
import { type NineSlice, fitNineSlice } from "../domain/nineSlice.js";

/** A pixel pair counts as different above this (max over premultiplied RGB and alpha, 0-255). */
const PIXEL_DIFF = 32;

/**
 * Suggest 9-slice margins: on each axis, find the band of neighbouring columns (rows) that are
 * nearly identical — the part that can stretch without visible change — preferring the band that
 * crosses the centre. A pair of lines is "identical" when almost no pixel differs by more than
 * PIXEL_DIFF, so noise and smooth gradients pass but borders and corner ornaments don't.
 * Returns null when either axis has no such band.
 */
export async function detectNineSlice(data: Buffer): Promise<NineSlice | null> {
  const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const at = (x: number, y: number) => (y * width + x) * 4;
  const differs = (i: number, j: number) => {
    const ai = raw[i + 3];
    const aj = raw[j + 3];
    if (Math.abs(ai - aj) > PIXEL_DIFF) return true;
    for (let c = 0; c < 3; c++) if (Math.abs((raw[i + c] * ai - raw[j + c] * aj) / 255) > PIXEL_DIFF) return true;
    return false;
  };
  /** same[k]: line k and line k+1 match along the whole other axis. */
  const lines = (n: number, m: number, pair: (k: number, t: number) => [number, number]) => {
    const allowed = Math.max(1, Math.floor(m * 0.005));
    const same: boolean[] = [];
    for (let k = 0; k < n - 1; k++) {
      let bad = 0;
      for (let t = 0; t < m && bad <= allowed; t++) if (differs(...pair(k, t))) bad++;
      same.push(bad <= allowed);
    }
    return band(same, n);
  };
  const h = lines(width, height, (x, y) => [at(x, y), at(x + 1, y)]);
  const v = lines(height, width, (y, x) => [at(x, y), at(x, y + 1)]);
  if (!h || !v) return null;
  return fitNineSlice({ left: h[0], top: v[0], right: h[1], bottom: v[1] }, width, height);
}

/**
 * Render the image stretched to width×height the way an engine draws a 9-slice: corners kept,
 * edges stretched along one axis, centre along both. Used to show the agent how its margins behave.
 */
export async function stretchNineSlice(data: Buffer, s: NineSlice, width: number, height: number, pixel = false): Promise<Buffer> {
  const src = sharp(data).ensureAlpha();
  const { width: w = 0, height: h = 0 } = await src.metadata();
  /** [offset, length] of the before / middle / after bands along one axis */
  const bands = (a: number, b: number, n: number) => [[0, a], [a, n - a - b], [n - b, b]] as const;
  const [sx, sy] = [bands(s.left, s.right, w), bands(s.top, s.bottom, h)];
  const [tx, ty] = [bands(s.left, s.right, width), bands(s.top, s.bottom, height)];
  const parts: OverlayOptions[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (!sx[c][1] || !sy[r][1] || !tx[c][1] || !ty[r][1]) continue;
      const input = await src
        .clone()
        .extract({ left: sx[c][0], top: sy[r][0], width: sx[c][1], height: sy[r][1] })
        .resize(tx[c][1], ty[r][1], { fit: "fill", kernel: pixel ? sharp.kernel.nearest : sharp.kernel.lanczos3 })
        .png()
        .toBuffer();
      parts.push({ input, left: tx[c][0], top: ty[r][0] });
    }
  }
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts).png().toBuffer();
}

/**
 * From the per-gap "same" flags of n lines, pick the stretch band and return [before, after] margins.
 * The band must span at least 3 lines (or 2% of the size) and not touch an edge; the one containing the centre wins, else the longest.
 */
function band(same: boolean[], n: number): [number, number] | null {
  const runs: [number, number][] = [];
  for (let k = 0; k < same.length; k++) {
    if (!same[k]) continue;
    const start = k;
    while (k + 1 < same.length && same[k + 1]) k++;
    runs.push([start, k + 1]); // lines start..k+1 match
  }
  const minLen = Math.max(3, Math.round(n * 0.02));
  // A band touching the image edge is empty padding beside the subject, not a stretch region.
  const ok = runs.filter(([a, b]) => b - a + 1 >= minLen && a > 0 && b < n - 1);
  if (!ok.length) return null;
  const mid = (n - 1) / 2;
  const best = ok.find(([a, b]) => a <= mid && mid <= b) ?? ok.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x));
  return [best[0], n - 1 - best[1]];
}
