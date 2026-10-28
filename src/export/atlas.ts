import sharp from "sharp";
import type { NineSlice } from "../domain/nineSlice.js";
import { msg } from "../i18n.js";

export interface AtlasInput {
  name: string;
  data: Buffer;
  /** written to the frame as TexturePacker's scale9Borders */
  nineSlice?: NineSlice;
}

export interface Placed {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasPage {
  width: number;
  height: number;
  frames: Placed[];
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/**
 * Shelf-pack rectangles into power-of-two pages no larger than maxSize.
 * Tallest first; each page tries widths from small to large and keeps the smallest area that fits.
 * Rectangles larger than a page throw.
 */
export function packRects(rects: { name: string; w: number; h: number }[], maxSize = 2048, padding = 2): AtlasPage[] {
  for (const r of rects) {
    if (r.w + padding * 2 > maxSize || r.h + padding * 2 > maxSize) throw new Error(msg("err.atlasTooBig", { name: r.name, w: r.w, h: r.h, max: maxSize }));
  }
  let remaining = [...rects].sort((a, b) => b.h - a.h || b.w - a.w || a.name.localeCompare(b.name));
  const pages: AtlasPage[] = [];
  while (remaining.length) {
    let best: { page: AtlasPage; rest: typeof remaining } | null = null;
    const widest = Math.max(...remaining.map((r) => r.w)) + padding * 2;
    for (let width = nextPow2(widest); width <= maxSize; width *= 2) {
      const frames: Placed[] = [];
      const rest: typeof remaining = [];
      let x = padding;
      let y = padding;
      let shelf = 0;
      for (const r of remaining) {
        if (x + r.w + padding > width) {
          x = padding;
          y += shelf + padding;
          shelf = 0;
        }
        if (y + r.h + padding > maxSize) {
          rest.push(r);
          continue;
        }
        frames.push({ name: r.name, x, y, w: r.w, h: r.h });
        x += r.w + padding;
        shelf = Math.max(shelf, r.h);
      }
      const height = nextPow2(Math.max(...frames.map((f) => f.y + f.h)) + padding);
      const page = { width, height, frames };
      const better = !best || rest.length < best.rest.length || (rest.length === best.rest.length && width * height < best.page.width * best.page.height);
      if (better) best = { page, rest };
      if (!rest.length && height <= width) break; // fits and is roughly square: good enough
    }
    pages.push(best!.page);
    remaining = best!.rest;
  }
  return pages;
}

/** Fit inside maxSprite px (never enlarges); nearest-neighbour for pixel art. */
export function scaleSprite(data: Buffer, maxSprite: number, pixel: boolean): Promise<Buffer> {
  return sharp(data)
    .ensureAlpha()
    .resize(maxSprite, maxSprite, { fit: "inside", withoutEnlargement: true, kernel: pixel ? sharp.kernel.nearest : sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}

/** Trim transparent margins, then scale. Not for animation frames, which must keep a shared size and anchor. */
export async function prepareSprite(data: Buffer, maxSprite: number, pixel: boolean): Promise<Buffer> {
  const trimmed = await sharp(data).ensureAlpha().trim({ threshold: 1 }).png().toBuffer().catch(() => data);
  return scaleSprite(trimmed, maxSprite, pixel);
}

export interface BuiltAtlas {
  pages: { image: string; png: Buffer; json: object }[];
}

/** Compose the page images and TexturePacker "JSON Hash" descriptors (loadable by Phaser, PixiJS, etc.). */
export async function buildAtlas(images: AtlasInput[], opts: { maxSize?: number; padding?: number; baseName?: string } = {}): Promise<BuiltAtlas> {
  const padding = opts.padding ?? 2;
  const sizes = await Promise.all(images.map(async (i) => ({ name: i.name, ...(await sharp(i.data).metadata()) })));
  const pages = packRects(sizes.map((s) => ({ name: s.name, w: s.width!, h: s.height! })), opts.maxSize ?? 2048, padding);
  const byName = new Map(images.map((i) => [i.name, i.data]));
  const sliceOf = new Map(images.flatMap((i) => (i.nineSlice ? [[i.name, i.nineSlice] as const] : [])));
  const base = opts.baseName ?? "atlas";
  return {
    pages: await Promise.all(
      pages.map(async (p, i) => {
        const image = pages.length > 1 ? `${base}_${i}.png` : `${base}.png`;
        const png = await sharp({ create: { width: p.width, height: p.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite(p.frames.map((f) => ({ input: byName.get(f.name)!, left: f.x, top: f.y })))
          .png()
          .toBuffer();
        const frames = Object.fromEntries(
          p.frames.map((f) => {
            const s = sliceOf.get(f.name);
            return [
              f.name,
              {
                frame: { x: f.x, y: f.y, w: f.w, h: f.h },
                rotated: false,
                trimmed: false,
                spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
                sourceSize: { w: f.w, h: f.h },
                // TexturePacker's 9-slice field: the stretchable centre rectangle
                ...(s ? { scale9Borders: { x: s.left, y: s.top, w: f.w - s.left - s.right, h: f.h - s.top - s.bottom } } : {}),
              },
            ];
          }),
        );
        const json = {
          frames,
          meta: { app: "game-asset-agent", version: "1.0", image, format: "RGBA8888", size: { w: p.width, h: p.height }, scale: "1" },
        };
        return { image, png, json };
      }),
    ),
  };
}
