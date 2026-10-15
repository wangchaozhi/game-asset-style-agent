import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { isOpaque, removeBackground } from "../src/image/background.js";
import { shrink, toPng } from "../src/image/io.js";
import { isPixelArt, parseSize, resizeAsset } from "../src/image/sizes.js";
import { detectFrameCount, sliceSheet } from "../src/image/spriteSheet.js";
import { analyzeSeams, makeSeamless, tilePreview } from "../src/image/tiles.js";
import { pixel, solidPng, validStyleGuide } from "./helpers.js";

/** A red square centred on a flat background colour. */
const subjectOn = (bg: string) =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: bg } })
    .composite([{ input: { create: { width: 24, height: 24, channels: 3, background: "#cc0000" } }, left: 20, top: 20 }])
    .png()
    .toBuffer();

/** n blobs separated by fully transparent columns. */
async function stripOf(n: number) {
  const fw = 40;
  const blobs = Array.from({ length: n }, (_, i) => ({
    input: { create: { width: 24, height: 24, channels: 4 as const, background: { r: (i * 60) % 256, g: 0, b: 200, alpha: 1 } } },
    left: i * fw + 8,
    top: 8,
  }));
  return sharp({ create: { width: n * fw, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(blobs)
    .png()
    .toBuffer();
}

describe("background removal", () => {
  it("detects opaque vs transparent images", async () => {
    assert.equal(await isOpaque(await subjectOn("#ffffff")), true);
    assert.equal(await isOpaque(await stripOf(2)), false);
  });

  it("clears a white backdrop and keeps the subject", async () => {
    const out = await removeBackground(await subjectOn("#ffffff"));
    assert.equal((await pixel(out, 0, 0)).a, 0);
    assert.equal((await pixel(out, 63, 63)).a, 0);
    assert.deepEqual(await pixel(out, 32, 32), { r: 204, g: 0, b: 0, a: 255 });
  });

  it("works with any flat backdrop colour, e.g. magenta", async () => {
    const out = await removeBackground(await subjectOn("#ff00ff"));
    assert.equal((await pixel(out, 5, 5)).a, 0);
    assert.equal((await pixel(out, 30, 30)).a, 255);
  });

  it("keeps background-coloured pixels that are enclosed by the subject", async () => {
    const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ffffff" } })
      .composite([
        { input: { create: { width: 32, height: 32, channels: 3, background: "#000000" } }, left: 16, top: 16 },
        { input: { create: { width: 8, height: 8, channels: 3, background: "#ffffff" } }, left: 28, top: 28 },
      ])
      .png()
      .toBuffer();
    const out = await removeBackground(img);
    assert.equal((await pixel(out, 31, 31)).a, 255, "inner white highlight survives");
    assert.equal((await pixel(out, 2, 2)).a, 0);
  });
});

describe("sprite sheets", () => {
  it("counts frames from transparent gaps", async () => {
    assert.equal(await detectFrameCount(await stripOf(4)), 4);
    assert.equal(await detectFrameCount(await stripOf(7)), 7);
  });

  it("gives up on opaque sheets", async () => {
    assert.equal(await detectFrameCount(await solidPng(200, 40, "#336699")), null);
  });

  it("slices equal frames and builds a looping GIF", async () => {
    const sheet = await sliceSheet(await stripOf(4), 4, 10);
    assert.equal(sheet.frameCount, 4);
    assert.equal(sheet.frames.length, 4);
    for (const f of sheet.frames) assert.deepEqual([(await sharp(f).metadata()).width, (await sharp(f).metadata()).height], [40, 40]);
    const gif = await sharp(sheet.gif, { animated: true }).metadata();
    assert.equal(gif.format, "gif");
    assert.equal(gif.pages, 4);
    assert.deepEqual(gif.delay, [100, 100, 100, 100]);
  });

  it("refuses frames narrower than 4px", async () => {
    await assert.rejects(sliceSheet(await solidPng(20, 10, "#000000"), 10), /帧数过多/);
  });
});

describe("tile seams", () => {
  it("a flat tile is seamless", async () => {
    const r = await analyzeSeams(await solidPng(32, 32, "#557755"));
    assert.equal(r.seamless, true);
    assert.equal(r.horizontalDiff, 0);
  });

  it("a left-to-right gradient has a horizontal seam but no vertical one", async () => {
    const w = 64;
    const raw = Buffer.alloc(w * w * 3);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) raw.fill(Math.round((x / (w - 1)) * 255), (y * w + x) * 3, (y * w + x) * 3 + 3);
    const png = await sharp(raw, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer();
    const r = await analyzeSeams(png);
    assert.equal(r.horizontalOk, false);
    assert.equal(r.verticalOk, true);
    assert.equal(r.seamless, false);
  });

  it("makeSeamless fixes both seams of a diagonal gradient and keeps the size", async () => {
    const w = 96;
    const h = 64;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        raw[i] = Math.round((x / (w - 1)) * 255);
        raw[i + 1] = Math.round((y / (h - 1)) * 255);
        raw[i + 2] = 80;
      }
    }
    const tile = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const before = await analyzeSeams(tile);
    assert.deepEqual([before.horizontalOk, before.verticalOk], [false, false]);
    const fixed = await makeSeamless(tile, { overlap: 0.2 });
    const meta = await sharp(fixed).metadata();
    assert.deepEqual([meta.width, meta.height], [w, h]);
    const after = await analyzeSeams(fixed);
    assert.equal(after.seamless, true, JSON.stringify(after));
    assert.ok(after.horizontalDiff < before.horizontalDiff / 10);
  });

  it("makeSeamless refuses tiles too small to blend", async () => {
    await assert.rejects(makeSeamless(await solidPng(2, 2, "#000000")), /太小/);
  });

  it("previews an n×n repeat", async () => {
    const meta = await sharp(await tilePreview(await solidPng(20, 10, "#123456"), 3)).metadata();
    assert.deepEqual([meta.width, meta.height], [60, 30]);
  });
});

describe("game sizes", () => {
  it("parses N and WxH within 8-4096", () => {
    assert.deepEqual(parseSize("32"), { w: 32, h: 32 });
    assert.deepEqual(parseSize("1280x720"), { w: 1280, h: 720 });
    for (const bad of ["4", "5000", "32x", "x32", "abc", "32X32", ""]) assert.equal(parseSize(bad), null, bad);
  });

  it("detects pixel-art style guides", () => {
    assert.equal(isPixelArt(validStyleGuide()), true);
    assert.equal(isPixelArt({ ...validStyleGuide(), rendering: "hand painted", summary: "painterly", prompt_prefix: "Soft painted look, wide brush strokes everywhere." }), false);
    assert.equal(isPixelArt(null), false);
  });

  it("trims transparent margins before fitting an icon", async () => {
    const out = await resizeAsset(await stripOf(1), { w: 16, h: 16, assetType: "item_icon", pixel: true });
    const meta = await sharp(out).metadata();
    assert.deepEqual([meta.width, meta.height], [16, 16]);
    // the 24px blob fills the whole 16px icon once margins are trimmed
    assert.equal((await pixel(out, 0, 0)).a, 255);
  });

  it("keeps sprite strips as frames × height", async () => {
    const meta = await sharp(await resizeAsset(await stripOf(4), { w: 32, h: 32, assetType: "sprite_sheet", pixel: true, frames: 4 })).metadata();
    assert.deepEqual([meta.width, meta.height], [128, 32]);
  });

  it("backgrounds cover the target", async () => {
    const out = await resizeAsset(await solidPng(300, 100, "#00aa00"), { w: 64, h: 64, assetType: "background", pixel: false });
    assert.equal((await pixel(out, 0, 0)).a, 255);
  });

  it("handles a fully transparent image without throwing", async () => {
    const empty = await solidPng(40, 40, "#000000", 0);
    const meta = await sharp(await resizeAsset(empty, { w: 16, h: 16, assetType: "prop", pixel: false })).metadata();
    assert.equal(meta.width, 16);
  });
});

describe("image io", () => {
  it("shrink fits inside the box, flattens alpha to JPEG, never enlarges", async () => {
    const big = await shrink({ data: await solidPng(2000, 1000, "#ff0000", 0.5), mime: "image/png" }, 768);
    const m = await sharp(big.data).metadata();
    assert.deepEqual([big.mime, m.format, m.width, m.height, m.hasAlpha], ["image/jpeg", "jpeg", 768, 384, false]);
    const small = await sharp((await shrink({ data: await solidPng(100, 50, "#ff0000"), mime: "image/png" })).data).metadata();
    assert.deepEqual([small.width, small.height], [100, 50]);
  });

  it("toPng keeps alpha and caps at 2048", async () => {
    const m = await sharp(await toPng(await solidPng(3000, 300, "#000000", 0.2))).metadata();
    assert.deepEqual([m.format, m.width, m.hasAlpha], ["png", 2048, true]);
  });
});
