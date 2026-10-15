import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** Allowed thumbnail widths (keeps the cache bounded). */
export const THUMB_WIDTHS = [160, 320, 640] as const;

/** Cache path for a thumbnail of `rel` (e.g. assets/ast_x.png) inside a project directory. */
export const thumbPath = (dir: string, rel: string, width: number, pixel: boolean) =>
  path.join(dir, "thumbs", path.dirname(rel), `${path.basename(rel)}.${width}${pixel ? "n" : ""}.webp`);

/**
 * Return a WebP thumbnail of a project file, generating it when missing or older than the source.
 * Animated GIFs stay animated. Pixel art is scaled with nearest-neighbour to stay crisp.
 */
export async function getThumb(dir: string, rel: string, width: number, pixel: boolean): Promise<Buffer> {
  const src = path.join(dir, rel);
  const out = thumbPath(dir, rel, width, pixel);
  const [srcStat, outStat] = await Promise.all([fs.stat(src), fs.stat(out).catch(() => null)]);
  if (outStat && outStat.mtimeMs >= srcStat.mtimeMs) return fs.readFile(out);
  const animated = rel.endsWith(".gif");
  const data = await sharp(src, { animated })
    .resize(width, width, { fit: "inside", withoutEnlargement: !pixel, kernel: pixel ? sharp.kernel.nearest : sharp.kernel.lanczos3 })
    .webp({ quality: 82, alphaQuality: 90, effort: 3, ...(pixel ? { nearLossless: true } : {}) })
    .toBuffer();
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, data);
  return data;
}

/** Thumbnail file name → the source file name it was made from. */
export const thumbSource = (thumbName: string) => thumbName.replace(/\.\d+n?\.webp$/, "");
