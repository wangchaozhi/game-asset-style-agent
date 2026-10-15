import sharp from "sharp";

/** True when every pixel is (nearly) opaque, i.e. the image has no usable transparency. */
export async function isOpaque(data: Buffer): Promise<boolean> {
  const { channels, isOpaque } = await sharp(data).stats();
  return channels.length < 4 || isOpaque;
}

/**
 * Remove a flat background by flood-filling from the image border.
 * The background colour is the median of the border pixels, so it works for white,
 * magenta or any solid backdrop the image model chose. Only pixels connected to the
 * border are removed, so same-coloured highlights inside the subject survive.
 * Pixels just outside the tolerance get partial alpha for a soft anti-aliased edge.
 */
export async function removeBackground(data: Buffer, tolerance = 28): Promise<Buffer> {
  const { data: px, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x: number, y: number) => (y * w + x) * 4;

  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(at(x, 0), at(x, h - 1));
  for (let y = 1; y < h - 1; y++) border.push(at(0, y), at(w - 1, y));
  const median = (ch: number) => {
    const v = border.map((i) => px[i + ch]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const bg = [median(0), median(1), median(2)];
  const dist = (i: number) =>
    Math.sqrt((px[i] - bg[0]) ** 2 + (px[i + 1] - bg[1]) ** 2 + (px[i + 2] - bg[2]) ** 2);

  const soft = tolerance * 1.8;
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (visited[p]) return;
    visited[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) push(x, 0), push(x, h - 1);
  for (let y = 0; y < h; y++) push(0, y), push(w - 1, y);

  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    // Already-transparent pixels are background too: keep spreading through them.
    if (px[i + 3] !== 0) {
      const d = dist(i);
      if (d > soft) continue;
      if (d <= tolerance) px[i + 3] = 0;
      else {
        // edge band: fade alpha proportionally and stop spreading
        px[i + 3] = Math.min(px[i + 3], Math.round(((d - tolerance) / (soft - tolerance)) * 255));
        continue;
      }
    }
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
