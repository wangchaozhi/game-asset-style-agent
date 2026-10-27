import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTION_PRESETS, actionSetRequest, isActionKey } from "../src/domain/actionSet.js";

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
