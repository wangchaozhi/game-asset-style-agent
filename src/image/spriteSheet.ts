import sharp from "sharp";

/**
 * Guess the frame count of a horizontal sprite sheet from its alpha channel:
 * count runs of non-empty columns separated by fully transparent gaps.
 * Returns null when the sheet is opaque or the guess is implausible.
 */
export async function detectFrameCount(data: Buffer): Promise<number | null> {
  const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const filled: boolean[] = new Array(width).fill(false);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (raw[(y * width + x) * channels + 3] > 16) {
        filled[x] = true;
        break;
      }
    }
  }
  if (filled.every(Boolean)) return null;
  const minGap = Math.max(2, Math.round(width * 0.004));
  let runs = 0;
  let gap = minGap;
  for (const f of filled) {
    if (f) {
      if (gap >= minGap) runs++;
      gap = 0;
    } else gap++;
  }
  return runs >= 2 && runs <= 16 ? runs : null;
}

export interface SlicedSheet {
  frames: Buffer[];
  gif: Buffer;
  frameCount: number;
}

/** Cut a single-row sprite sheet into equal-width frames and build a looping GIF preview. */
export async function sliceSheet(data: Buffer, frameCount: number, fps = 8): Promise<SlicedSheet> {
  const meta = await sharp(data).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const count = Math.max(1, Math.min(32, Math.floor(frameCount)));
  const fw = Math.floor(width / count);
  if (fw < 4) throw new Error("帧数过多，单帧宽度不足");
  const frames = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      sharp(data).extract({ left: i * fw, top: 0, width: fw, height }).png().toBuffer(),
    ),
  );
  const delay = Math.round(1000 / Math.max(1, Math.min(30, fps)));
  const gif = await sharp(frames, { join: { animated: true } })
    .gif({ delay: new Array(count).fill(delay), loop: 0 })
    .toBuffer();
  return { frames, gif, frameCount: count };
}

export interface FrameBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  empty: boolean;
}

/** Bounding box of pixels with alpha above the threshold. */
export async function contentBox(frame: Buffer, alphaThreshold = 16): Promise<FrameBox & { width: number; height: number }> {
  const { data, info } = await sharp(frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const empty = right < 0;
  return empty ? { left: 0, top: 0, right: 0, bottom: 0, empty, width, height } : { left, top, right, bottom, empty, width, height };
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

export interface Jitter {
  /** spread (max - min) of the content's horizontal centre across frames, px */
  horizontal: number;
  /** spread of the content's bottom edge (or vertical centre in "center" mode), px */
  vertical: number;
}

export type AlignMode = "bottom" | "center";

const anchors = (b: FrameBox, mode: AlignMode) => ({ x: (b.left + b.right) / 2, y: mode === "bottom" ? b.bottom : (b.top + b.bottom) / 2 });

export async function measureJitter(frames: Buffer[], mode: AlignMode = "bottom"): Promise<Jitter> {
  const boxes = (await Promise.all(frames.map((f) => contentBox(f)))).filter((b) => !b.empty);
  if (boxes.length < 2) return { horizontal: 0, vertical: 0 };
  const a = boxes.map((b) => anchors(b, mode));
  const spread = (v: number[]) => Math.round((Math.max(...v) - Math.min(...v)) * 10) / 10;
  return { horizontal: spread(a.map((p) => p.x)), vertical: spread(a.map((p) => p.y)) };
}

/**
 * Shift each frame so its content's anchor (bottom-centre for characters standing on the ground,
 * or centre for floating effects) sits on the median anchor of all frames. Frames keep their size;
 * shifts are clamped so content never leaves the cell. Empty frames are left alone.
 */
export async function alignFrames(frames: Buffer[], mode: AlignMode = "bottom"): Promise<Buffer[]> {
  const boxes = await Promise.all(frames.map((f) => contentBox(f)));
  const live = boxes.filter((b) => !b.empty);
  if (!live.length) return frames;
  const target = { x: median(live.map((b) => anchors(b, mode).x)), y: median(live.map((b) => anchors(b, mode).y)) };
  return Promise.all(
    frames.map(async (f, i) => {
      const b = boxes[i];
      if (b.empty) return f;
      const a = anchors(b, mode);
      const dx = Math.max(-b.left, Math.min(b.width - 1 - b.right, Math.round(target.x - a.x)));
      const dy = Math.max(-b.top, Math.min(b.height - 1 - b.bottom, Math.round(target.y - a.y)));
      if (!dx && !dy) return f;
      // Crop the content box and paste it at the shifted position on a clear canvas of the same size.
      const piece = await sharp(f).ensureAlpha().extract({ left: b.left, top: b.top, width: b.right - b.left + 1, height: b.bottom - b.top + 1 }).png().toBuffer();
      return sharp({ create: { width: b.width, height: b.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: piece, left: b.left + dx, top: b.top + dy }])
        .png()
        .toBuffer();
    }),
  );
}

/** Lay equal-size frames out in one row. */
export async function joinFrames(frames: Buffer[]): Promise<Buffer> {
  const meta = await sharp(frames[0]).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  return sharp({ create: { width: w * frames.length, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((input, i) => ({ input, left: i * w, top: 0 })))
    .png()
    .toBuffer();
}
