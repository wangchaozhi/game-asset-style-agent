import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { fitNineSlice, parseNineSlice, scaleNineSlice } from "../src/domain/nineSlice.js";
import { buildAtlas } from "../src/export/atlas.js";
import { detectNineSlice, stretchNineSlice } from "../src/image/nineSlice.js";
import { styleBoxTextureTres } from "../src/export/godot.js";
import { panel, pixel, solidPng } from "./helpers.js";

describe("parseNineSlice", () => {
  it("accepts margins that leave a stretchable centre", () => {
    assert.deepEqual(parseNineSlice({ left: 4, top: 0, right: 5, bottom: 3, extra: 1 }, 10, 4), { left: 4, top: 0, right: 5, bottom: 3 });
  });

  it("rejects bad shapes, values and margins that leave no centre", () => {
    for (const bad of [null, "4", { left: 1, top: 1, right: 1 }, { left: -1, top: 1, right: 1, bottom: 1 }, { left: 1.5, top: 1, right: 1, bottom: 1 }]) {
      assert.equal(typeof parseNineSlice(bad, 10, 10), "string", JSON.stringify(bad));
    }
    assert.match(parseNineSlice({ left: 5, top: 1, right: 5, bottom: 1 }, 10, 10) as string, /宽度 10px/);
    assert.match(parseNineSlice({ left: 1, top: 6, right: 1, bottom: 4 }, 10, 10) as string, /高度 10px/);
    assert.match(parseNineSlice({ left: 0, top: 0, right: 0, bottom: 0 }, 10, 10) as string, /全为 0/);
  });

  it("fitNineSlice drops margins that no longer fit the image", () => {
    const m = { left: 4, top: 4, right: 4, bottom: 4 };
    assert.deepEqual(fitNineSlice(m, 9, 9), m);
    assert.equal(fitNineSlice(m, 8, 9), null);
    assert.equal(fitNineSlice(undefined, 8, 8), null);
  });
});

describe("scaleNineSlice", () => {
  it("scales each axis and rounds", () => {
    assert.deepEqual(scaleNineSlice({ left: 10, top: 20, right: 30, bottom: 5 }, { width: 100, height: 100 }, { width: 50, height: 25 }), {
      left: 5, top: 5, right: 15, bottom: 1,
    });
  });

  it("keeps at least 1px of centre when rounding would swallow it", () => {
    const s = scaleNineSlice({ left: 3, top: 1, right: 3, bottom: 1 }, { width: 7, height: 3 }, { width: 2, height: 3 });
    assert.ok(s.left + s.right < 2, JSON.stringify(s));
  });
});

describe("9-slice exports", () => {
  it("buildAtlas writes scale9Borders for frames that have margins", async () => {
    const atlas = await buildAtlas([
      { name: "panel", data: await solidPng(40, 20, "#336699"), nineSlice: { left: 6, top: 4, right: 8, bottom: 2 } },
      { name: "icon", data: await solidPng(16, 16, "#ff0000") },
    ]);
    const frames = (atlas.pages[0].json as { frames: Record<string, { scale9Borders?: object }> }).frames;
    assert.deepEqual(frames.panel.scale9Borders, { x: 6, y: 4, w: 26, h: 14 });
    assert.equal(frames.icon.scale9Borders, undefined);
  });

  it("styleBoxTextureTres writes the texture and its four margins", () => {
    const tres = styleBoxTextureTres("res://assets/ui/panel.png", { left: 6, top: 4, right: 8, bottom: 2 });
    assert.match(tres, /^\[gd_resource type="StyleBoxTexture" load_steps=2 format=3\]/);
    assert.match(tres, /\[ext_resource type="Texture2D" path="res:\/\/assets\/ui\/panel.png" id="1"\]/);
    assert.match(tres, /texture = ExtResource\("1"\)/);
    assert.deepEqual(
      [...tres.matchAll(/texture_margin_(\w+) = ([\d.]+)/g)].map((m) => [m[1], m[2]]),
      [["left", "6.0"], ["top", "4.0"], ["right", "8.0"], ["bottom", "2.0"]],
    );
  });
});

describe("detectNineSlice", () => {
  const corners = { left: 12, top: 12, right: 12, bottom: 12 };

  it("finds the band between corner ornaments", async () => {
    assert.deepEqual(await detectNineSlice(await panel(100, 60)), corners);
  });

  it("tolerates per-pixel noise and smooth gradients", async () => {
    assert.deepEqual(await detectNineSlice(await panel(100, 60, { noise: 10 })), corners);
    assert.deepEqual(await detectNineSlice(await panel(100, 60, { gradient: true })), corners);
  });

  it("counts transparent padding as part of the margins", async () => {
    const padded = await sharp({ create: { width: 140, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await panel(100, 60), left: 15, top: 25 }])
      .png()
      .toBuffer();
    assert.deepEqual(await detectNineSlice(padded), { left: 27, top: 37, right: 37, bottom: 27 });
  });

  it("ignores blank padding at the image edge when the subject itself can't stretch", async () => {
    // A diamond: every interior column and row differs from its neighbour.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><polygon points="60,10 100,40 60,70 20,40" fill="#3a6"/></svg>`;
    assert.equal(await detectNineSlice(await sharp(Buffer.from(svg)).png().toBuffer()), null);
  });

  it("returns null when nothing can stretch, or everything can", async () => {
    const raw = Buffer.alloc(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) raw.set([((i % 64) + Math.floor(i / 64)) % 2 ? 255 : 0, 0, 0, 255], i * 4);
    const checker = await sharp(raw, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
    assert.equal(await detectNineSlice(checker), null);
    assert.equal(await detectNineSlice(await solidPng(32, 32, "#336699")), null);
  });
});

describe("stretchNineSlice", () => {
  it("keeps corners and stretches the rest to the requested size", async () => {
    const m = { left: 12, top: 12, right: 12, bottom: 12 };
    const out = await stretchNineSlice(await panel(100, 60), m, 250, 90);
    const meta = await sharp(out).metadata();
    assert.deepEqual([meta.width, meta.height], [250, 90]);
    const ornament = { r: 230, g: 190, b: 40, a: 255 };
    for (const [x, y] of [[2, 2], [247, 2], [2, 87], [247, 87], [11, 11], [238, 78]]) assert.deepEqual(await pixel(out, x, y), ornament, `${x},${y}`);
    assert.deepEqual(await pixel(out, 125, 3), { r: 60, g: 30, b: 90, a: 255 }, "top border stretched");
    assert.deepEqual(await pixel(out, 125, 45), { r: 140, g: 90, b: 60, a: 255 }, "centre fill");
  });

  it("skips empty bands when a margin is 0", async () => {
    const out = await stretchNineSlice(await solidPng(20, 20, "#336699"), { left: 0, top: 5, right: 0, bottom: 5 }, 40, 30);
    assert.deepEqual(await pixel(out, 0, 15), { r: 0x33, g: 0x66, b: 0x99, a: 255 });
  });
});
