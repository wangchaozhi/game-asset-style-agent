import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addImageCall, addTokens, computeCost, imagePrice, modelPrice, newRunUsage, summarize, totalTokens } from "../src/usage/index.js";

describe("modelPrice", () => {
  it("matches the most specific model family first", () => {
    assert.equal(modelPrice("claude-opus-5-5", {})?.input, 4);
    assert.equal(modelPrice("claude-opus-5", {})?.input, 5);
    assert.equal(modelPrice("claude-fable-5-1", {})?.cacheRead, 0.25);
    assert.equal(modelPrice("claude-fable-5", {})?.cacheRead, 1);
    assert.equal(modelPrice("claude-haiku-5-5", {})?.output, 0.5);
    assert.equal(modelPrice("claude-sonnet-4-5", {})?.input, 3);
  });

  it("returns null for unknown models", () => {
    assert.equal(modelPrice("some-other-model", {}), null);
  });

  it("CLAUDE_PRICE overrides every model, and is ignored when malformed", () => {
    assert.deepEqual(modelPrice("x", { CLAUDE_PRICE: "1,2,3,4" }), { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 });
    assert.equal(modelPrice("claude-opus-5-5", { CLAUDE_PRICE: "1,2,3" })?.input, 4);
    assert.equal(modelPrice("claude-opus-5-5", { CLAUDE_PRICE: "a,b,c,d" })?.input, 4);
  });
});

describe("imagePrice", () => {
  it("mock is free; others come from IMAGE_PRICE_<ID>", () => {
    assert.equal(imagePrice("mock", {}), 0);
    assert.equal(imagePrice("openai", {}), null);
    assert.equal(imagePrice("openai", { IMAGE_PRICE_OPENAI: "0.17" }), 0.17);
    assert.equal(imagePrice("gemini", { IMAGE_PRICE_GEMINI: " " }), null);
    assert.equal(imagePrice("gemini", { IMAGE_PRICE_GEMINI: "-1" }), null);
  });
});

describe("run usage", () => {
  it("accumulates tokens per model and prices them", () => {
    const run = newRunUsage("job_1", "req", "agent");
    addTokens(run, "claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: null, cache_read_input_tokens: 1_000_000 });
    addTokens(run, "claude-opus-5-5", { input_tokens: 0, output_tokens: 100_000 });
    assert.equal(run.claude.requests, 2);
    assert.deepEqual(totalTokens(run), {
      input_tokens: 1_000_000, output_tokens: 200_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000,
    });
    // 1M*4 + 0.2M*20 + 1M*0.2 = 8.2
    assert.equal(run.cost.claude, 8.2);
  });

  it("keeps tokens apart when a fallback model served some turns", () => {
    const run = newRunUsage("job_1", "", "agent");
    addTokens(run, "claude-opus-5-5", { input_tokens: 1_000_000 });
    addTokens(run, "claude-sonnet-5-5", { input_tokens: 1_000_000 });
    assert.deepEqual(Object.keys(run.claude.byModel).sort(), ["claude-opus-5-5", "claude-sonnet-5-5"]);
    assert.equal(run.cost.claude, 6);
  });

  it("counts failed image calls without billing them", () => {
    const run = newRunUsage("job_1", "", "demo");
    addImageCall(run, "mock", true);
    addImageCall(run, "mock", false);
    assert.equal(run.images.calls, 2);
    assert.equal(run.images.failed, 1);
    assert.deepEqual(run.images.byProvider, { mock: 1 });
  });

  it("marks a cost part null when its price is unknown, but still totals the rest", () => {
    const run = newRunUsage("job_1", "", "agent");
    addTokens(run, "claude-opus-5-5", { output_tokens: 1_000_000 });
    run.images.byProvider = { openai: 3 };
    assert.deepEqual(computeCost(run, {}), { claude: 20, images: null, total: 20 });
    assert.deepEqual(computeCost(run, { IMAGE_PRICE_OPENAI: "0.1" }), { claude: 20, images: 0.3, total: 20.3 });
  });

  it("summarize adds runs up and propagates unknown prices", () => {
    const a = newRunUsage("a", "", "agent");
    addTokens(a, "claude-opus-5-5", { input_tokens: 500_000 });
    const b = newRunUsage("b", "", "agent");
    addTokens(b, "mystery-model", { input_tokens: 10 });
    addImageCall(b, "mock", true);
    const s = summarize([a, b]);
    assert.equal(s.runs, 2);
    assert.equal(s.claudeRequests, 2);
    assert.equal(s.tokens.input_tokens, 500_010);
    assert.equal(s.images.calls, 1);
    assert.equal(s.cost.claude, null);
    assert.equal(s.cost.images, 0);
    assert.equal(s.cost.total, 2);
  });

  it("summarize of nothing is all zeros", () => {
    assert.deepEqual(summarize([]).cost, { claude: 0, images: 0, total: 0 });
  });
});
