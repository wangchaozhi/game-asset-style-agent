import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

/** Point the store at a fresh temp directory. Call before touching any store function. */
export function useTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaa-test-"));
  process.env.DATA_DIR = dir;
  process.env.MOCK_DELAY_MS = "0";
  return dir;
}

export const solidPng = (w: number, h: number, color: string, alpha = 1) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { ...hexRgb(color), alpha } } }).png().toBuffer();

export function hexRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
}

/** RGBA of one pixel. */
export async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

export const validStyleGuide = () => ({
  summary: "Cozy pixel art",
  palette: [
    { hex: "#112233", role: "outline" },
    { hex: "#aabbcc", role: "base" },
    { hex: "#ffeedd", role: "highlight" },
  ],
  rendering: "16x16 pixel art",
  line_and_edges: "1px dark outline",
  lighting_and_shading: "2-tone",
  perspective: "top-down 3/4",
  proportions: "chibi",
  texture_and_detail: "low",
  mood: "cozy",
  avoid: ["gradients"],
  prompt_prefix: "Cozy 16x16 pixel art, 1px outline, palette #112233 #aabbcc #ffeedd.",
});
