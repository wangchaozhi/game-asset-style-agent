import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { analyzePalette, deltaE, describePalette, hexToRgb, rgbToLab } from "../src/image/palette.js";
import { solidPng } from "./helpers.js";

const PALETTE = ["#1a1c2c", "#5d275d", "#b13e53", "#ef7d57"];

/** Left half one colour, right half another, optional transparent border. */
const halves = (left: string, right: string) =>
  sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: { create: { width: 20, height: 20, channels: 3, background: left } }, left: 0, top: 0 },
      { input: { create: { width: 20, height: 20, channels: 3, background: right } }, left: 20, top: 0 },
    ])
    .png()
    .toBuffer();

describe("colour maths", () => {
  it("converts sRGB to Lab with sane anchors", () => {
    const white = rgbToLab(255, 255, 255);
    assert.ok(Math.abs(white[0] - 100) < 0.01 && Math.abs(white[1]) < 0.01 && Math.abs(white[2]) < 0.01);
    assert.ok(Math.abs(rgbToLab(0, 0, 0)[0]) < 0.01);
    assert.ok(rgbToLab(255, 0, 0)[1] > 70, "red has a large positive a*");
  });

  it("ΔE is 0 for identical colours and large for black vs white", () => {
    assert.equal(deltaE(rgbToLab(10, 20, 30), rgbToLab(10, 20, 30)), 0);
    assert.ok(deltaE(rgbToLab(0, 0, 0), rgbToLab(255, 255, 255)) > 99);
  });

  it("parses hex with or without #", () => {
    assert.deepEqual(hexToRgb("#ff8000"), [255, 128, 0]);
    assert.deepEqual(hexToRgb("0080ff"), [0, 128, 255]);
  });
});

describe("analyzePalette", () => {
  it("an image painted only with palette colours is fully on-palette", async () => {
    const r = await analyzePalette(await halves("#1a1c2c", "#ef7d57"), PALETTE);
    assert.equal(r.coverage, 1);
    assert.equal(r.meanDeltaE, 0);
    assert.deepEqual(r.offPalette, []);
    assert.deepEqual(r.usage.map((u) => u.share), [0.5, 0, 0, 0.5]);
    assert.equal(r.pixels, 800);
  });

  it("near-palette shades still count, far colours are reported", async () => {
    const r = await analyzePalette(await halves("#1c1e2e", "#22cc22"), PALETTE);
    assert.equal(r.coverage, 0.5);
    assert.equal(r.offPalette.length, 1);
    assert.equal(r.offPalette[0].hex, "#22cc22");
    assert.equal(r.offPalette[0].share, 0.5);
    assert.ok(r.meanDeltaE > 20);
  });

  it("ignores transparent pixels", async () => {
    const img = await sharp({ create: { width: 30, height: 30, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 10, height: 10, channels: 3, background: "#b13e53" } }, left: 10, top: 10 }])
      .png()
      .toBuffer();
    const r = await analyzePalette(img, PALETTE);
    assert.equal(r.pixels, 100);
    assert.equal(r.coverage, 1);
  });

  it("the threshold decides what counts as close", async () => {
    const img = await solidPng(10, 10, "#2a2c3c"); // a little off #1a1c2c
    assert.equal((await analyzePalette(img, PALETTE, { threshold: 20 })).coverage, 1);
    assert.equal((await analyzePalette(img, PALETTE, { threshold: 2 })).coverage, 0);
  });

  it("samples large images down for speed", async () => {
    const r = await analyzePalette(await solidPng(1024, 512, "#5d275d"), PALETTE, { sampleSize: 64 });
    assert.equal(r.pixels, 64 * 32);
  });

  it("handles an empty palette and a fully transparent image", async () => {
    assert.equal((await analyzePalette(await solidPng(8, 8, "#ffffff"), [])).coverage, 0);
    const blank = await analyzePalette(await solidPng(8, 8, "#ffffff", 0), PALETTE);
    assert.deepEqual([blank.pixels, blank.coverage, blank.meanDeltaE], [0, 0, 0]);
  });
});

describe("describePalette", () => {
  it("summarises coverage and off-palette colours for Claude", () => {
    const text = describePalette({ coverage: 0.734, meanDeltaE: 12.3, offPalette: [{ hex: "#22cc22", share: 0.2 }] });
    assert.match(text, /73% of opaque pixels within ΔE 20/);
    assert.match(text, /#22cc22 \(20%\)/);
  });
});
