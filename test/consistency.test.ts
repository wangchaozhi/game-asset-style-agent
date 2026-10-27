import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankDrift } from "../src/domain/consistency.js";

const item = (id: string, coverage: number, meanDeltaE: number, score?: number) => ({ id, coverage, meanDeltaE, score, offPalette: [{ hex: "#ff00ff", share: 0.3 }] });

describe("rankDrift", () => {
  it("ranks against the project's own median and explains why", () => {
    const r = rankDrift([item("a", 0.9, 8), item("b", 0.88, 9), item("c", 0.5, 25, 4), item("d", 0.91, 7)]);
    assert.equal(r.medianCoverage, 0.89);
    assert.equal(r.medianDeltaE, 8.5);
    assert.deepEqual(r.items.map((i) => i.id).slice(0, 1), ["c"]);
    const c = r.items[0];
    assert.ok(c.drift > 50, String(c.drift));
    assert.deepEqual(c.reasons, ["色板内像素 50%，低于项目中位数 89%", "平均色差 ΔE 25，高于项目中位数 8.5", "Agent 一致性评分 4/10", "主要色板外颜色 #ff00ff（30%）"]);
    for (const other of r.items.slice(1)) assert.deepEqual(other.reasons, [], other.id);
  });

  it("does not flag small differences, and handles an empty project", () => {
    const r = rankDrift([item("a", 0.8, 10), item("b", 0.75, 13)]);
    assert.ok(r.items.every((i) => !i.reasons.length));
    assert.deepEqual(rankDrift([]), { medianCoverage: 0, medianDeltaE: 0, items: [] });
  });

  it("a score alone counts only when the agent scored below 7", () => {
    const r = rankDrift([item("a", 0.9, 8, 9), item("b", 0.9, 8, 6)]);
    assert.deepEqual(r.items.map((i) => [i.id, i.drift]), [["b", 5], ["a", 0]]);
  });
});
