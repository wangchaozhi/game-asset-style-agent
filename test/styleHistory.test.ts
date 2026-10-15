import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useTempDataDir, validStyleGuide } from "./helpers.js";

useTempDataDir();
const store = await import("../src/store/index.js");

const sg = (summary: string) => ({ ...validStyleGuide(), summary });

describe("style history", () => {
  it("records versions in order and skips consecutive duplicates", async () => {
    const { id } = await store.createProject("h");
    await store.recordStyleVersion(id, sg("a"), "agent");
    await store.recordStyleVersion(id, sg("a"), "user");
    await store.recordStyleVersion(id, sg("b"), "user");
    const list = await store.loadStyleHistory(id);
    assert.deepEqual(list.map((v) => [v.styleGuide.summary, v.source]), [["a", "agent"], ["b", "user"]]);
  });

  it("keeps the guide being replaced when the history was empty", async () => {
    const { id } = await store.createProject("h2");
    await store.recordStyleVersion(id, sg("new"), "user", sg("old"));
    assert.deepEqual((await store.loadStyleHistory(id)).map((v) => [v.styleGuide.summary, v.source]), [["old", "import"], ["new", "user"]]);
  });

  it("keeps only the latest 50 versions", async () => {
    const { id } = await store.createProject("h3");
    for (let i = 0; i < 55; i++) await store.recordStyleVersion(id, sg(`v${i}`), "user");
    const list = await store.loadStyleHistory(id);
    assert.equal(list.length, 50);
    assert.equal(list[0].styleGuide.summary, "v5");
  });

  it("styleDiff names the changed fields", () => {
    const a = validStyleGuide();
    const b = { ...validStyleGuide(), mood: "grim", palette: [...a.palette, { hex: "#000000", role: "x" }] };
    assert.deepEqual(store.styleDiff(a, b).sort(), ["mood", "palette"]);
    assert.deepEqual(store.styleDiff(a, validStyleGuide()), []);
    assert.deepEqual(store.styleDiff(a, null), ["*"]);
  });
});
