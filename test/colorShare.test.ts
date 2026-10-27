import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { colorShare } from "../src/image/recolor.js";

/** Left half red, right half blue, bottom row transparent. */
async function halves() {
  const raw = Buffer.alloc(20 * 12 * 4);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 20; x++) raw.set(y >= 10 ? [0, 0, 0, 0] : x < 10 ? [220, 40, 40, 255] : [40, 60, 220, 255], (y * 20 + x) * 4);
  }
  return sharp(raw, { raw: { width: 20, height: 12, channels: 4 } }).png().toBuffer();
}

describe("colorShare", () => {
  it("measures the share of visible pixels near a colour", async () => {
    const img = await halves();
    assert.equal(await colorShare(img, "#dc2828"), 0.5);
    assert.equal(await colorShare(img, "#d63030"), 0.5, "close shades count");
    assert.equal(await colorShare(img, "#00ff00"), 0);
  });

  it("respects the threshold and ignores transparent pixels", async () => {
    assert.equal(await colorShare(await halves(), "#b43c3c", 5), 0, "too far at ΔE 5");
    const clear = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    assert.equal(await colorShare(clear, "#000000"), 0);
  });
});
