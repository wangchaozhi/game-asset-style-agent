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
