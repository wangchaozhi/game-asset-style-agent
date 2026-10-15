import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GenerateInput, ReviewInput, StyleGuideInput } from "../src/agent/schemas.js";
import { validStyleGuide } from "./helpers.js";

describe("StyleGuideInput", () => {
  it("accepts a complete guide", () => {
    assert.ok(StyleGuideInput.safeParse(validStyleGuide()).success);
  });

  it("rejects bad hex codes and short palettes", () => {
    const badHex = validStyleGuide();
    badHex.palette[0].hex = "#12345";
    assert.equal(StyleGuideInput.safeParse(badHex).success, false);
    const short = validStyleGuide();
    short.palette = short.palette.slice(0, 2);
    assert.equal(StyleGuideInput.safeParse(short).success, false);
  });

  it("requires a substantive prompt_prefix and every field", () => {
    assert.equal(StyleGuideInput.safeParse({ ...validStyleGuide(), prompt_prefix: "too short" }).success, false);
    const { mood: _m, ...missing } = validStyleGuide();
    assert.equal(StyleGuideInput.safeParse(missing).success, false);
  });
});

describe("GenerateInput", () => {
  const base = {
    name: "火焰剑",
    asset_type: "item_icon",
    prompt: "A flaming sword icon, centred, transparent background",
    aspect: "square",
    transparent_background: true,
  };

  it("accepts a minimal valid call", () => {
    assert.ok(GenerateInput.safeParse(base).success);
  });

  it("rejects unknown asset types and aspects", () => {
    assert.equal(GenerateInput.safeParse({ ...base, asset_type: "weapon" }).success, false);
    assert.equal(GenerateInput.safeParse({ ...base, aspect: "wide" }).success, false);
  });

  it("bounds frames and consistency references", () => {
    assert.ok(GenerateInput.safeParse({ ...base, asset_type: "sprite_sheet", frames: 8 }).success);
    assert.equal(GenerateInput.safeParse({ ...base, frames: 1 }).success, false);
    assert.equal(GenerateInput.safeParse({ ...base, frames: 17 }).success, false);
    assert.equal(GenerateInput.safeParse({ ...base, frames: 2.5 }).success, false);
    assert.equal(GenerateInput.safeParse({ ...base, consistency_asset_ids: ["a", "b", "c", "d", "e"] }).success, false);
  });

  it("rejects a string where a boolean is expected", () => {
    assert.equal(GenerateInput.safeParse({ ...base, transparent_background: "true" }).success, false);
  });
});

describe("ReviewInput", () => {
  it("scores must be integers 1-10", () => {
    const r = { asset_id: "ast_1", verdict: "approved", consistency_score: 8, notes: "ok" };
    assert.ok(ReviewInput.safeParse(r).success);
    assert.equal(ReviewInput.safeParse({ ...r, consistency_score: 0 }).success, false);
    assert.equal(ReviewInput.safeParse({ ...r, consistency_score: 11 }).success, false);
    assert.equal(ReviewInput.safeParse({ ...r, consistency_score: 7.5 }).success, false);
    assert.equal(ReviewInput.safeParse({ ...r, verdict: "maybe" }).success, false);
  });
});
