import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MAX_IMAGES, budgetBlock, pastHardStop, resolveBudget } from "../src/agent/budget.js";
import { addImageCall, addTokens, newRunUsage } from "../src/usage/index.js";

describe("resolveBudget", () => {
  it("defaults to a 40-image cap and no cost cap", () => {
    assert.deepEqual(resolveBudget(undefined, {}), { maxImages: DEFAULT_MAX_IMAGES, maxUsd: null });
  });

  it("reads RUN_MAX_IMAGES / RUN_MAX_USD; empty means unlimited", () => {
    assert.deepEqual(resolveBudget(undefined, { RUN_MAX_IMAGES: "12", RUN_MAX_USD: "2.5" }), { maxImages: 12, maxUsd: 2.5 });
    assert.deepEqual(resolveBudget(undefined, { RUN_MAX_IMAGES: "" }), { maxImages: null, maxUsd: null });
  });

  it("per-run values override; 0 means unlimited; fractions of images round down", () => {
    const env = { RUN_MAX_IMAGES: "12", RUN_MAX_USD: "2.5" };
    assert.deepEqual(resolveBudget({ maxImages: 3 }, env), { maxImages: 3, maxUsd: 2.5 });
    assert.deepEqual(resolveBudget({ maxImages: 0, maxUsd: 0 }, env), { maxImages: null, maxUsd: null });
    assert.deepEqual(resolveBudget({ maxImages: 4.9, maxUsd: "1" }, env), { maxImages: 4, maxUsd: 1 });
    assert.deepEqual(resolveBudget({ maxImages: "abc", maxUsd: -1 }, env), { maxImages: null, maxUsd: null });
  });
});

describe("budgetBlock / pastHardStop", () => {
  it("blocks once the image count is reached", () => {
    const u = newRunUsage("j", "", "agent");
    const b = { maxImages: 2, maxUsd: null };
    addImageCall(u, "mock", true);
    assert.equal(budgetBlock(b, u), null);
    addImageCall(u, "mock", false); // failed calls count too: they hit the API
    assert.match(budgetBlock(b, u)!, /图像调用上限 2 次/);
  });

  it("blocks once estimated cost is reached, and hard-stops at 125%", () => {
    const u = newRunUsage("j", "", "agent");
    const b = { maxImages: null, maxUsd: 1 };
    addTokens(u, "claude-opus-5-5", { output_tokens: 49_000 }); // $0.98
    assert.equal(budgetBlock(b, u), null);
    addTokens(u, "claude-opus-5-5", { output_tokens: 2_000 }); // $1.02
    assert.match(budgetBlock(b, u)!, /费用上限 \$1/);
    assert.equal(pastHardStop(b, u), false);
    addTokens(u, "claude-opus-5-5", { output_tokens: 12_000 }); // $1.26
    assert.equal(pastHardStop(b, u), true);
  });

  it("unlimited never blocks", () => {
    const u = newRunUsage("j", "", "agent");
    for (let i = 0; i < 100; i++) addImageCall(u, "mock", true);
    assert.equal(budgetBlock({ maxImages: null, maxUsd: null }, u), null);
  });
});
