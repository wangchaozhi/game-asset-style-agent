import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { addOutline, darkestColor } from "../src/image/outline.js";
import { pixel } from "./helpers.js";

/** A 20×20 transparent canvas with a red 6×6 square at (7,7)-(12,12). */
const square = () =>
  sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 6, height: 6, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }, left: 7, top: 7 }])
    .png()
    .toBuffer();

const BLUE = { r: 0, g: 0, b: 255, a: 255 };
const CLEAR = 0;

describe("addOutline", () => {
  it("rings the subject with an opaque band of the given width and leaves it untouched", async () => {
    const out = await addOutline(await square(), { width: 2, color: "#0000ff" });
    assert.deepEqual(await pixel(out, 9, 9), { r: 255, g: 0, b: 0, a: 255 }, "subject");
    assert.deepEqual(await pixel(out, 6, 9), BLUE, "1px out");
    assert.deepEqual(await pixel(out, 5, 9), BLUE, "2px out");
    assert.equal((await pixel(out, 4, 9)).a, CLEAR, "3px out stays clear");
    assert.equal((await pixel(out, 0, 0)).a, CLEAR);
    const meta = await sharp(out).metadata();
    assert.deepEqual([meta.width, meta.height], [20, 20], "same size");
  });

  it("rounds corners with the round brush and keeps them square for pixel art", async () => {
    const round = await addOutline(await square(), { width: 3, color: "#0000ff" });
    const sq = await addOutline(await square(), { width: 3, color: "#0000ff", square: true });
    assert.equal((await pixel(round, 4, 4)).a, CLEAR, "diagonal corner cut off");
    assert.deepEqual(await pixel(sq, 4, 4), BLUE, "square brush fills the corner");
  });

  it("blends anti-aliased edge pixels over the outline colour", async () => {
    const soft = await sharp({ create: { width: 9, height: 9, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: { create: { width: 3, height: 3, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }, left: 3, top: 3 },
        { input: { create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }, left: 2, top: 4 },
      ])
      .png()
      .toBuffer();
    const out = await addOutline(soft, { width: 1, color: "#0000ff" });
    // The 50% edge pixel itself sits on the outline: no see-through gap between subject and outline.
    const p = await pixel(out, 2, 4);
    assert.equal(p.a, 255);
    assert.ok(p.r > 100 && p.b > 100, JSON.stringify(p));
    assert.deepEqual(await pixel(out, 1, 4), BLUE, "and the ring continues outside it");
  });

  it("darkestColor picks the lowest-luminance palette colour", () => {
    assert.equal(darkestColor(["#aabbcc", "#112233", "#ffeedd"]), "#112233");
    assert.equal(darkestColor([]), "#1a1a1a");
  });
});
