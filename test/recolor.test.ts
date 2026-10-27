import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { rgbToLab } from "../src/image/palette.js";
import { dominantColors, labToRgb, recolor } from "../src/image/recolor.js";
import { pixel } from "./helpers.js";

/** Columns: red | dark red | green, on a transparent row below. */
async function strip() {
  const raw = Buffer.alloc(30 * 20 * 4);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 30; x++) {
      const c = y >= 10 ? [0, 0, 0, 0] : x < 10 ? [220, 40, 40, 255] : x < 20 ? [150, 20, 20, 255] : [40, 200, 60, 255];
      raw.set(c, (y * 30 + x) * 4);
    }
  }
  return sharp(raw, { raw: { width: 30, height: 20, channels: 4 } }).png().toBuffer();
}

describe("labToRgb", () => {
  it("inverts rgbToLab", () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [220, 40, 40], [12, 200, 180], [128, 128, 128]] as [number, number, number][]) {
      const back = labToRgb(rgbToLab(...c));
      back.forEach((v, i) => assert.ok(Math.abs(v - c[i]) <= 1, `${c} → ${back}`));
    }
  });
});

describe("dominantColors", () => {
  it("lists visible colours by share, ignoring transparency", async () => {
    const colors = await dominantColors(await strip());
    assert.deepEqual(colors.map((c) => c.hex), ["#dc2828", "#961414", "#28c83c"]);
    for (const c of colors) assert.ok(Math.abs(c.share - 1 / 3) < 0.02, JSON.stringify(c));
  });

  it("merges close shades into one colour", async () => {
    const colors = await dominantColors(await strip(), { merge: 40 });
    assert.equal(colors.length, 2);
    assert.ok(colors[0].share > 0.6);
  });
});

describe("recolor", () => {
  it("moves a colour and its shades together, leaving other colours and alpha alone", async () => {
    const out = await recolor(await strip(), [{ from: "#dc2828", to: "#2840dc" }], 45);
    const main = await pixel(out, 5, 5);
    const shade = await pixel(out, 15, 5);
    assert.ok(main.b > 180 && main.r < 80, `main ${JSON.stringify(main)}`);
    assert.ok(shade.b > shade.r && shade.b < main.b, `shade stays darker: ${JSON.stringify(shade)}`);
    assert.deepEqual(await pixel(out, 25, 5), { r: 40, g: 200, b: 60, a: 255 }, "green untouched");
    assert.equal((await pixel(out, 5, 15)).a, 0, "transparent stays transparent");
  });

  it("only touches pixels within the threshold", async () => {
    const out = await recolor(await strip(), [{ from: "#dc2828", to: "#2840dc" }], 10);
    assert.deepEqual(await pixel(out, 15, 5), { r: 150, g: 20, b: 20, a: 255 }, "dark red is too far at ΔE 10");
  });
});
