import sharp from "sharp";
import type { StyleGuide } from "../store/types.js";

/** Common in-game sizes per asset type. Square entries are "N"; others "WxH". */
export const SIZE_PRESETS: Record<string, string[]> = {
  item_icon: ["16", "32", "64", "128"],
  ui: ["32", "64", "128", "256"],
  tile: ["16", "32", "64", "128"],
  prop: ["32", "64", "128", "256"],
  character: ["64", "128", "256", "512"],
  enemy: ["64", "128", "256", "512"],
  sprite_sheet: ["32", "64", "128"], // per frame height
  portrait: ["128", "256", "512"],
  vfx: ["64", "128", "256"],
  background: ["640x360", "1280x720", "1920x1080"],
};

export function parseSize(spec: string): { w: number; h: number } | null {
  const m = /^(\d{1,4})(?:x(\d{1,4}))?$/.exec(spec);
  if (!m) return null;
  const w = Number(m[1]);
  const h = m[2] ? Number(m[2]) : w;
  if (w < 8 || h < 8 || w > 4096 || h > 4096) return null;
  return { w, h };
}

export const isPixelArt = (sg: StyleGuide | null) =>
  !!sg && /pixel|像素|8-?bit|16-?bit/i.test(`${sg.rendering} ${sg.summary} ${sg.prompt_prefix}`);

/**
 * Resize to an exact game size.
 * - Transparent assets are trimmed to their content first, then fitted with transparent padding,
 *   so a 32px icon uses the whole 32px instead of the model's empty margins.
 * - Backgrounds and tiles fill (cover) the target.
 * - Pixel art uses nearest-neighbour so pixels stay crisp.
 */
export async function resizeAsset(
  data: Buffer,
  opts: { w: number; h: number; assetType: string; pixel: boolean; frames?: number },
): Promise<Buffer> {
  const kernel = opts.pixel ? sharp.kernel.nearest : sharp.kernel.lanczos3;
  const fill = opts.assetType === "background" || opts.assetType === "tile";
  if (opts.assetType === "sprite_sheet" && opts.frames && opts.frames > 1) {
    // Keep the strip layout: each frame becomes h×h, laid out horizontally.
    return sharp(data)
      .resize(opts.h * opts.frames, opts.h, { fit: "contain", kernel, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }
  // trim() throws on an image with no content; fall back to the untrimmed source then.
  const source = fill ? data : await sharp(data).ensureAlpha().trim({ threshold: 1 }).png().toBuffer().catch(() => data);
  return sharp(source)
    .ensureAlpha()
    .resize(opts.w, opts.h, {
      fit: fill ? "cover" : "contain",
      kernel,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
