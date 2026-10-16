import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasTag, normalizeTags } from "../src/domain/tags.js";

describe("normalizeTags", () => {
  it("trims, collapses spaces, dedupes case-insensitively and caps", () => {
    assert.deepEqual(normalizeTags(["  第一关 ", "UI", "ui", "", 5, "a  b"]), ["第一关", "UI", "a b"]);
    assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 10);
    assert.equal(normalizeTags(["x".repeat(50)])[0].length, 20);
    assert.deepEqual(normalizeTags("nope"), []);
  });

  it("hasTag ignores case", () => {
    assert.ok(hasTag(["Boss"], "boss"));
    assert.ok(!hasTag(undefined, "boss"));
  });
});
