import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTION_PRESETS, actionOrder, actionSetRequest, animationFor, isActionKey } from "../src/domain/actionSet.js";

describe("action set request", () => {
  it("asks for one sheet per action with frames, fps, the reference and the tag", () => {
    const req = actionSetRequest({ id: "ast_fox", name: "小狐狸" }, ["idle", "attack"]);
    assert.match(req, /共 2 张/);
    assert.match(req, /「小狐狸·待机」: sprite_sheet, frames=4, fps=6/);
    assert.match(req, /「小狐狸·攻击」: sprite_sheet, frames=5, fps=12/);
    assert.match(req, /consistency_asset_ids=\["ast_fox"\] and tags=\["小狐狸"\]/);
    assert.doesNotMatch(req, /行走/);
  });

  it("presets stay within the sprite sheet limits", () => {
    for (const [k, p] of Object.entries(ACTION_PRESETS)) {
      assert.ok(isActionKey(k));
      assert.ok(p.frames >= 2 && p.frames <= 16 && p.fps >= 1 && p.fps <= 30, k);
    }
    assert.equal(isActionKey("dance"), false);
    assert.equal(isActionKey(1), false);
  });
});

describe("animationFor", () => {
  it("names action-set sheets by their action and loops only the cyclic ones", () => {
    assert.deepEqual(animationFor("小狐狸·待机", "小狐狸", false, "x"), { name: "待机", loop: true });
    assert.deepEqual(animationFor("小狐狸·受击", "小狐狸", false, "x"), { name: "受击", loop: false });
    assert.deepEqual(animationFor("小狐狸·攻击", "小狐狸", true, "x"), { name: "attack", loop: false });
  });

  it("falls back to the file stem for other sheets", () => {
    assert.deepEqual(animationFor("跳舞", "小狐狸", false, "跳舞"), { name: "跳舞", loop: true });
    assert.deepEqual(animationFor("小狐狸·跳舞", "小狐狸", false, "stem"), { name: "跳舞", loop: true });
    assert.deepEqual(animationFor("小狐狸·跳舞", "小狐狸", true, "sprite_sheet_03"), { name: "sprite_sheet_03", loop: true });
  });
});

describe("actionOrder", () => {
  it("follows the preset order, unknown sheets last", () => {
    const names = ["狐·受击", "狐·待机", "跳舞", "狐·行走"];
    assert.deepEqual([...names].sort((a, b) => actionOrder(a, "狐") - actionOrder(b, "狐")), ["狐·待机", "狐·行走", "狐·受击", "跳舞"]);
  });
});
