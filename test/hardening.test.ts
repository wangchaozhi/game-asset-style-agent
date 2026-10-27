import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isActionKey } from "../src/domain/actionSet.js";
import { isAssetType } from "../src/domain/assetTypes.js";
import { spriteFramesMultiTres, styleBoxTextureTres } from "../src/export/godot.js";
import { animationClip, spriteMeta } from "../src/export/unity.js";

describe("input hardening", () => {
  it("lookup checks accept only their own keys, not inherited object properties", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      assert.equal(isAssetType(k), false, k);
      assert.equal(isActionKey(k), false, k);
    }
    assert.ok(isAssetType("item_icon") && isActionKey("idle"));
  });

  it("Godot strings escape backslashes and quotes, so a name can't end the literal early", () => {
    const tres = spriteFramesMultiTres([{ name: 'a\\" ]\nbad', paths: ['res://x\\"y.png'], fps: 8, loop: true }]);
    assert.match(tres, /"name": &"a\\\\\\" \] bad",/);
    assert.match(tres, /path="res:\/\/x\\\\\\"y\.png"/);
    assert.match(styleBoxTextureTres('res://p\\".png', { left: 1, top: 1, right: 1, bottom: 1 }), /path="res:\/\/p\\\\\\"\.png"/);
  });

  it("Unity YAML names keep letters (any script) and digits, nothing YAML could read as syntax", () => {
    const meta = spriteMeta({ seed: "s", pixel: false, frames: { count: 1, width: 8, height: 8, name: "{a}: b #c 小狐狸" } });
    assert.match(meta, /name: a_b_c_小狐狸_0\n/);
    assert.match(meta, /nameFileIdTable:\n {6}a_b_c_小狐狸_0: \d+/);
    assert.match(animationClip({ name: "- [x]", sheetSeed: "s", count: 1, fps: 8 }), /m_Name: x\n/);
  });
});
