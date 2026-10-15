import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import zlib from "node:zlib";
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

/** Minimal reader: walk the central directory and inflate each entry. */
export function readZip(buf: Buffer) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, { data: Buffer; method: number; utf8: boolean }> = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, usize);
    assert.equal(zlib.crc32(data) >>> 0, crc, `crc of ${name}`);
    out[name] = { data, method, utf8: !!(flags & 0x800) };
    p += 46 + nlen;
  }
  return out;
}

