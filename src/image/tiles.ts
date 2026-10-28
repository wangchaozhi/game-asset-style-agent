import sharp from "sharp";
import { msg } from "../i18n.js";

export interface SeamReport {
  width: number;
  height: number;
  /** 左右边缘接缝差异（0-255 平均绝对差） */
  horizontalDiff: number;
  /** 上下边缘接缝差异 */
  verticalDiff: number;
  /** 图内相邻像素的典型差异，用作对照基线 */
  baseline: number;
  horizontalOk: boolean;
  verticalOk: boolean;
  seamless: boolean;
}

/** 接缝差异不超过基线的该倍数（或绝对差很小）即视为无缝。 */
const RATIO_LIMIT = 2.2;
const ABS_LIMIT = 6;

/**
 * 检测瓦片是否可无缝平铺：比较首尾两列 / 两行的像素差，
 * 并与图内相邻列 / 行的平均差（基线）对比，避免把本身纹理丰富的图误判为有接缝。
 */
export async function analyzeSeams(data: Buffer): Promise<SeamReport> {
  const { data: px, info } = await sharp(data).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const diff = (a: number, b: number) => {
    let s = 0;
    for (let k = 0; k < 3; k++) s += Math.abs(px[a + k] - px[b + k]);
    return s / 3;
  };
  const at = (x: number, y: number) => (y * w + x) * c;

  const meanCols = (x1: number, x2: number) => {
    let s = 0;
    for (let y = 0; y < h; y++) s += diff(at(x1, y), at(x2, y));
    return s / h;
  };
  const meanRows = (y1: number, y2: number) => {
    let s = 0;
    for (let x = 0; x < w; x++) s += diff(at(x, y1), at(x, y2));
    return s / w;
  };

  const horizontalDiff = w > 1 ? meanCols(w - 1, 0) : 0;
  const verticalDiff = h > 1 ? meanRows(h - 1, 0) : 0;

  let base = 0;
  let n = 0;
  for (let x = 0; x < w - 1; x++, n++) base += meanCols(x, x + 1);
  for (let y = 0; y < h - 1; y++, n++) base += meanRows(y, y + 1);
  const baseline = n ? base / n : 0;

  const ok = (d: number) => d <= ABS_LIMIT || d <= baseline * RATIO_LIMIT;
  const horizontalOk = ok(horizontalDiff);
  const verticalOk = ok(verticalDiff);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    width: w,
    height: h,
    horizontalDiff: r(horizontalDiff),
    verticalDiff: r(verticalDiff),
    baseline: r(baseline),
    horizontalOk,
    verticalOk,
    seamless: horizontalOk && verticalOk,
  };
}

/** 将瓦片重复 n×n 拼成一张预览图（边长上限 4096，超出则缩小）。 */
export async function tilePreview(data: Buffer, n = 3): Promise<Buffer> {
  let tile = sharp(data).ensureAlpha();
  const meta = await tile.metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const scale = Math.min(1, 4096 / (w * n), 4096 / (h * n));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const one = await tile.resize(tw, th).png().toBuffer();
  const comp = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) comp.push({ input: one, left: x * tw, top: y * th });
  return sharp({ create: { width: tw * n, height: th * n, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comp)
    .png()
    .toBuffer();
}

/**
 * Make a tile wrap seamlessly by cross-fading each edge band into the opposite one.
 * With overlap m, the result keeps columns [0, W-m) where column x < m becomes a blend of
 * x (weight x/m) and W-m+x (weight 1-x/m); its last and first columns are then neighbours in
 * the source, so the wrap is continuous. Rows get the same treatment, and the tile is scaled
 * back to its original size (nearest-neighbour for pixel art).
 */
export async function makeSeamless(data: Buffer, opts: { overlap?: number; pixel?: boolean } = {}): Promise<Buffer> {
  const overlap = Math.min(0.4, Math.max(0.04, opts.overlap ?? 0.15));
  const { data: src, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const mx = Math.max(1, Math.round(w * overlap));
  const my = Math.max(1, Math.round(h * overlap));
  if (w - mx < 2 || h - my < 2) throw new Error(msg("err.tileTooSmall"));

  // Horizontal pass: w×h → (w-mx)×h
  const w2 = w - mx;
  const hp = Buffer.alloc(w2 * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w2; x++) {
      const o = (y * w2 + x) * 4;
      const a = (y * w + x) * 4;
      if (x >= mx) {
        src.copy(hp, o, a, a + 4);
        continue;
      }
      const b = (y * w + (w - mx + x)) * 4;
      const t = x / mx;
      for (let c = 0; c < 4; c++) hp[o + c] = Math.round(src[a + c] * t + src[b + c] * (1 - t));
    }
  }
  // Vertical pass: (w-mx)×h → (w-mx)×(h-my)
  const h2 = h - my;
  const out = Buffer.alloc(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const o = (y * w2 + x) * 4;
      const a = (y * w2 + x) * 4;
      if (y >= my) {
        hp.copy(out, o, a, a + 4);
        continue;
      }
      const b = ((h - my + y) * w2 + x) * 4;
      const t = y / my;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(hp[a + c] * t + hp[b + c] * (1 - t));
    }
  }
  return sharp(out, { raw: { width: w2, height: h2, channels: 4 } })
    .resize(w, h, { fit: "fill", kernel: opts.pixel ? sharp.kernel.nearest : sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}
