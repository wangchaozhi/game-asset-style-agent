import { msg } from "../i18n.js";

/**
 * 9-slice margins, in pixels of the asset image: the four corners keep their size when stretched,
 * the edges stretch along one axis and the centre along both.
 */
export interface NineSlice {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const SIDES = ["left", "top", "right", "bottom"] as const;

/** Validate user input against the image size. Returns the clean margins or an error message. */
export function parseNineSlice(input: unknown, width: number, height: number): NineSlice | string {
  if (!input || typeof input !== "object") return msg("err.nineShape");
  const src = input as Record<string, unknown>;
  const out = {} as NineSlice;
  for (const side of SIDES) {
    const v = src[side];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return msg("err.nineInt");
    out[side] = v;
  }
  if (out.left + out.right >= width) return msg("err.nineWide", { n: width });
  if (out.top + out.bottom >= height) return msg("err.nineTall", { n: height });
  if (SIDES.every((s) => out[s] === 0)) return msg("err.nineZero");
  return out;
}

/** The stored margins if they still fit an image of this size (e.g. after a backup import or a new version), else null. */
export function fitNineSlice(slice: NineSlice | undefined, width: number, height: number): NineSlice | null {
  if (!slice) return null;
  const parsed = parseNineSlice(slice, width, height);
  return typeof parsed === "string" ? null : parsed;
}

/** Scale margins to a resized image, keeping at least 1px of stretchable centre on each axis. */
export function scaleNineSlice(slice: NineSlice, from: { width: number; height: number }, to: { width: number; height: number }): NineSlice {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const fit = (a: number, b: number, scale: number, size: number) => {
    let x = Math.round(a * scale);
    let y = Math.round(b * scale);
    while (x + y >= size && (x || y)) x >= y ? x-- : y--;
    return [x, y];
  };
  const [left, right] = fit(slice.left, slice.right, sx, to.width);
  const [top, bottom] = fit(slice.top, slice.bottom, sy, to.height);
  return { left, top, right, bottom };
}
