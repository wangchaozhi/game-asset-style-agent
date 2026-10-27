import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { animationClip, nativeMeta, spriteMeta, unityGuid } from "../src/export/unity.js";

const field = (meta: string, key: string) => meta.match(new RegExp(`^\\s*${key}: (.*)$`, "m"))?.[1];

describe("Unity sprite .meta", () => {
  it("derives a stable 32-hex GUID from the seed", () => {
    assert.match(unityGuid("p/a/image"), /^[0-9a-f]{32}$/);
    assert.equal(unityGuid("p/a/image"), unityGuid("p/a/image"));
    assert.notEqual(unityGuid("p/a/image"), unityGuid("p/a/frame:0"));
    assert.equal(field(spriteMeta({ seed: "p/a/image", pixel: false }), "guid"), unityGuid("p/a/image"));
  });

  it("imports a single sprite with smooth filtering by default", () => {
    const meta = spriteMeta({ seed: "s", pixel: false });
    assert.match(meta, /^fileFormatVersion: 2\n/);
    assert.deepEqual(
      ["textureType", "spriteMode", "filterMode", "wrapU", "textureCompression", "spritePivot", "spriteBorder"].map((k) => field(meta, k)),
      ["8", "1", "1", "1", "1", "{x: 0.5, y: 0.5}", "{x: 0, y: 0, z: 0, w: 0}"],
    );
    assert.match(meta, /sprites: \[\]/);
  });

  it("pixel art: point filter, no compression; tiles repeat; standing sprites pivot at the feet", () => {
    const meta = spriteMeta({ seed: "s", pixel: true, repeat: true, bottomPivot: true });
    assert.deepEqual(["filterMode", "textureCompression", "wrapU", "wrapV", "alignment", "spritePivot"].map((k) => field(meta, k)), [
      "0", "0", "0", "0", "7", "{x: 0.5, y: 0}",
    ]);
  });

  it("writes 9-slice margins in Unity's (left, bottom, right, top) order with a full-rect mesh", () => {
    const meta = spriteMeta({ seed: "s", pixel: false, nineSlice: { left: 1, top: 2, right: 3, bottom: 4 } });
    assert.equal(field(meta, "spriteBorder"), "{x: 1, y: 4, z: 3, w: 2}");
    assert.equal(field(meta, "spriteMeshType"), "0");
  });

  it("slices a sprite sheet into named frames left to right", () => {
    const meta = spriteMeta({ seed: "s", pixel: false, bottomPivot: true, frames: { count: 3, width: 32, height: 48, name: "walk" } });
    assert.equal(field(meta, "spriteMode"), "2");
    const sprites = [...meta.matchAll(/name: (walk_\d)\n\s+rect:\n\s+serializedVersion: 2\n\s+x: (\d+)\n\s+y: (\d+)\n\s+width: (\d+)\n\s+height: (\d+)/g)];
    assert.deepEqual(sprites.map((m) => m.slice(1).join(",")), ["walk_0,0,0,32,48", "walk_1,32,0,32,48", "walk_2,64,0,32,48"]);
    const ids = [...meta.matchAll(/internalID: (\d+)/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, 3);
    for (const [i, id] of ids.entries()) assert.match(meta, new RegExp(`walk_${i}: ${id}\\n`), "nameFileIdTable matches");
  });
});

describe("Unity AnimationClip", () => {
  it("keys every frame of the sheet by the sprite ids its .meta defines", () => {
    const meta = spriteMeta({ seed: "p/a/image", pixel: false, frames: { count: 4, width: 32, height: 32, name: "walk" } });
    const ids = [...meta.matchAll(/internalID: (\d+)/g)].map((m) => m[1]);
    const clip = animationClip({ name: "walk", sheetSeed: "p/a/image", count: 4, fps: 8 });
    assert.match(clip, /^%YAML 1\.1\n%TAG !u! tag:unity3d\.com,2011:\n--- !u!74 &7400000\nAnimationClip:/);
    const keys = [...clip.matchAll(/- time: ([\d.]+)\n\s+value: \{fileID: (\d+), guid: (\w+), type: 3\}/g)];
    assert.deepEqual(keys.map((k) => +k[1]), [0, 0.125, 0.25, 0.375]);
    assert.deepEqual(keys.map((k) => k[2]), ids);
    assert.ok(keys.every((k) => k[3] === unityGuid("p/a/image")));
    assert.deepEqual(["m_SampleRate", "m_StopTime", "m_LoopTime", "attribute"].map((k) => field(clip, k)), ["8", "0.5", "1", "m_Sprite"]);
  });

  it("native .meta points at the clip object", () => {
    const meta = nativeMeta("p/a/anim");
    assert.equal(field(meta, "guid"), unityGuid("p/a/anim"));
    assert.equal(field(meta, "mainObjectFileID"), "7400000");
  });
});
