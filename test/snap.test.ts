import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { analyzePalette, snapToPalette } from "../src/image/palette.js";
import { pixel } from "./helpers.js";

const PAL = ["#000000", "#ffffff", "#ff0000"];

/** A horizontal grey ramp with a transparent border column. */
async function ramp(w = 64, h = 8) {
  const raw = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = Math.round((x / (w - 1)) * 255);
    raw.set([v, v, v, x === 0 ? 0 : 255], i);
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

describe("snapToPalette", () => {
  it("uses only palette colours and keeps alpha", async () => {
    const out = await snapToPalette(await ramp(), PAL);
    const r = await analyzePalette(out, PAL, { threshold: 0.5 });
    assert.equal(r.coverage, 1);
    assert.equal((await pixel(out, 0, 0)).a, 0, "transparent pixels stay transparent");
    assert.deepEqual(await pixel(out, 63, 0), { r: 255, g: 255, b: 255, a: 255 });
    assert.deepEqual(await pixel(out, 2, 0), { r: 0, g: 0, b: 0, a: 255 });
  });

  it("hard snapping bands a ramp; ordered dithering mixes both neighbours in the middle", async () => {
    const hard = await snapToPalette(await ramp(), PAL);
    const dithered = await snapToPalette(await ramp(), PAL, { dither: "ordered" });
    /** Colour changes along one row: a hard snap has a single black→white edge, dithering many. */
    const transitions = async (png: Buffer, y = 3) => {
      const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let x = 2; x < 64; x++) if (data[(y * 64 + x) * 4] !== data[(y * 64 + x - 1) * 4]) n++;
      return n;
    };
    assert.equal(await transitions(hard), 1);
    assert.ok((await transitions(dithered)) >= 6, `dithered transitions: ${await transitions(dithered)}`);
  });

  it("refuses an empty palette", async () => {
    await assert.rejects(snapToPalette(await ramp(), []), /色板为空/);
  });
});
