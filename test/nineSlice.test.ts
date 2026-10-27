import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitNineSlice, parseNineSlice, scaleNineSlice } from "../src/domain/nineSlice.js";
import { buildAtlas } from "../src/export/atlas.js";
import { styleBoxTextureTres } from "../src/export/godot.js";
import { solidPng } from "./helpers.js";

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
