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
  const offsets: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (opts.square || dx * dx + dy * dy <= r * r + r) offsets.push([dx, dy]);
  }
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = raw[i * 4 + 3] >= SOLID ? 1 : 0;
  const [cr, cg, cb] = hexToRgb(opts.color);
  const out = Buffer.alloc(raw.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let ring = false;
      // Any pixel that isn't fully opaque, including the subject's own soft edge, gets the outline behind it.
      if (raw[i * 4 + 3] < 255) {
        for (const [dx, dy] of offsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && solid[ny * w + nx]) {
            ring = true;
            break;
          }
        }
      }
      const p = i * 4;
      const a = raw[p + 3] / 255;
      if (ring) {
        // Original over an opaque outline pixel.
        out[p] = Math.round(raw[p] * a + cr * (1 - a));
        out[p + 1] = Math.round(raw[p + 1] * a + cg * (1 - a));
        out[p + 2] = Math.round(raw[p + 2] * a + cb * (1 - a));
        out[p + 3] = 255;
      } else {
        out[p] = raw[p];
        out[p + 1] = raw[p + 1];
        out[p + 2] = raw[p + 2];
        out[p + 3] = raw[p + 3];
      }
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Default outline colour: the darkest palette colour, else near-black. */
export function darkestColor(palette: string[]): string {
  const lum = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return palette.length ? palette.reduce((a, b) => (lum(b) < lum(a) ? b : a)) : "#1a1a1a";
}
