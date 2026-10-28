import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cocosPlist } from "../src/export/cocos.js";

describe("cocos2d plist", () => {
  const page = {
    frames: { "item_icon/剑 & <盾>": { frame: { x: 2, y: 4, w: 32, h: 48 } }, "ui/panel": { frame: { x: 36, y: 4, w: 64, h: 64 } } },
    meta: { image: "atlas_0.png", size: { w: 128, h: 64 } },
  };
  const out = cocosPlist(page);

  it("writes format 3 metadata pointing at the page image", () => {
    assert.match(out, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!DOCTYPE plist/);
    assert.match(out, /<key>format<\/key>\s*<integer>3<\/integer>/);
    assert.match(out, /<key>size<\/key>\s*<string>\{128,64\}<\/string>/);
    assert.equal((out.match(/<string>atlas_0\.png<\/string>/g) ?? []).length, 2, "realTextureFileName and textureFileName");
  });

  it("writes one untrimmed, unrotated entry per frame, names escaped", () => {
    assert.ok(out.includes("<key>item_icon/剑 &amp; &lt;盾&gt;</key>"));
    assert.ok(out.includes("<string>{{2,4},{32,48}}</string>"));
    assert.ok(out.includes("<string>{{36,4},{64,64}}</string>"));
    assert.equal((out.match(/<key>textureRotated<\/key>\s*<false\/>/g) ?? []).length, 2);
    assert.equal((out.match(/<string>\{0,0\}<\/string>/g) ?? []).length, 2, "zero offsets");
  });

  it("balances every element", () => {
    for (const tag of ["dict", "plist"]) assert.equal((out.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length, (out.match(new RegExp(`</${tag}>`, "g")) ?? []).length, tag);
  });
});
