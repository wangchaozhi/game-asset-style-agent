import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { buildAtlas, packRects, prepareSprite } from "../src/export/atlas.js";
import { spriteFramesTres } from "../src/export/godot.js";
import { pixel, solidPng } from "./helpers.js";

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const isPow2 = (n: number) => (n & (n - 1)) === 0;

describe("packRects", () => {
  const rects = Array.from({ length: 40 }, (_, i) => ({ name: `r${i}`, w: 8 + ((i * 37) % 90), h: 8 + ((i * 53) % 70) }));

  it("places every rectangle without overlap, inside power-of-two pages, with padding", () => {
    const pages = packRects(rects, 1024, 2);
    const placed = pages.flatMap((p) => p.frames);
    assert.equal(placed.length, rects.length);
    for (const p of pages) {
      assert.ok(isPow2(p.width) && isPow2(p.height), `${p.width}x${p.height}`);
      for (const f of p.frames) {
        assert.ok(f.x >= 2 && f.y >= 2 && f.x + f.w + 2 <= p.width && f.y + f.h + 2 <= p.height, JSON.stringify(f));
      }
      for (let i = 0; i < p.frames.length; i++) {
        for (let j = i + 1; j < p.frames.length; j++) {
          const a = p.frames[i];
          const b = p.frames[j];
          assert.ok(!overlap({ ...a, w: a.w + 2, h: a.h + 2 }, b), `${a.name} overlaps ${b.name}`);
        }
      }
    }
    // sizes are kept
    for (const r of rects) {
      const f = placed.find((x) => x.name === r.name)!;
      assert.deepEqual([f.w, f.h], [r.w, r.h]);
    }
  });

  it("spills onto extra pages when one is not enough", () => {
    const big = Array.from({ length: 6 }, (_, i) => ({ name: `b${i}`, w: 200, h: 200 }));
    const pages = packRects(big, 512, 2);
    assert.ok(pages.length >= 2);
    assert.equal(pages.flatMap((p) => p.frames).length, 6);
    assert.ok(pages.every((p) => p.width <= 512 && p.height <= 512));
  });

  it("refuses a sprite bigger than a page", () => {
    assert.throws(() => packRects([{ name: "huge", w: 600, h: 10 }], 512), /超过图集最大尺寸/);
  });

  it("is deterministic", () => {
    assert.deepEqual(packRects(rects, 1024), packRects([...rects].reverse(), 1024));
  });
});

describe("buildAtlas", () => {
  it("composites sprites where the JSON says they are", async () => {
    const atlas = await buildAtlas([
      { name: "red", data: await solidPng(20, 10, "#ff0000") },
      { name: "blue", data: await solidPng(10, 30, "#0000ff") },
    ]);
    assert.equal(atlas.pages.length, 1);
    const { png, json, image } = atlas.pages[0];
    const meta = await sharp(png).metadata();
    const j = json as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta: { size: { w: number; h: number }; image: string } };
    assert.deepEqual([meta.width, meta.height], [j.meta.size.w, j.meta.size.h]);
    assert.equal(j.meta.image, image);
    const red = j.frames.red.frame;
    const blue = j.frames.blue.frame;
    assert.deepEqual([red.w, red.h, blue.w, blue.h], [20, 10, 10, 30]);
    assert.deepEqual(await pixel(png, red.x + 5, red.y + 5), { r: 255, g: 0, b: 0, a: 255 });
    assert.deepEqual(await pixel(png, blue.x + 5, blue.y + 20), { r: 0, g: 0, b: 255, a: 255 });
    assert.equal((await pixel(png, meta.width! - 1, meta.height! - 1)).a, 0, "empty space is transparent");
  });

  it("names pages atlas_0, atlas_1 … only when there are several", async () => {
    const big = await solidPng(300, 300, "#00ff00");
    const atlas = await buildAtlas([{ name: "a", data: big }, { name: "b", data: big }, { name: "c", data: big }], { maxSize: 512 });
    assert.deepEqual(atlas.pages.map((p) => p.image), ["atlas_0.png", "atlas_1.png", "atlas_2.png"]);
  });
});

describe("prepareSprite", () => {
  it("trims transparent margins then fits the max size", async () => {
    const padded = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await solidPng(200, 100, "#ff0000"), left: 100, top: 150 }])
      .png()
      .toBuffer();
    const meta = await sharp(await prepareSprite(padded, 64, false)).metadata();
    assert.deepEqual([meta.width, meta.height], [64, 32]);
  });
});

describe("Godot SpriteFrames", () => {
  it("writes one ext_resource per frame and the animation settings", () => {
    const tres = spriteFramesTres(["res://assets/a/00.png", "res://assets/a/01.png"], { fps: 12 });
    assert.match(tres, /^\[gd_resource type="SpriteFrames" load_steps=3 format=3\]/);
    assert.match(tres, /\[ext_resource type="Texture2D" path="res:\/\/assets\/a\/01.png" id="2"\]/);
    assert.equal(tres.match(/ExtResource\("\d"\)/g)?.length, 2);
    assert.match(tres, /"speed": 12.0/);
    assert.match(tres, /"loop": true/);
    assert.match(tres, /"name": &"default"/);
  });
});
