import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solidPng, useTempDataDir, validStyleGuide } from "./helpers.js";

useTempDataDir();
const store = await import("../src/store/index.js");
const { measureConsistency, consistencyCacheStats } = await import("../src/ops/consistency.js");

describe("consistency measurement cache", () => {
  it("reuses measurements until the palette or a file changes", async () => {
    const p = await store.createProject("cache");
    for (const [id, color] of [["ast_a", "#112233"], ["ast_b", "#ff00ff"]]) {
      await store.writeProjectFile(p.id, `assets/${id}.png`, await solidPng(16, 16, color));
      await store.updateProject(p.id, (q) => void q.assets.push({
        id, name: id, assetType: "item_icon", prompt: "", file: `assets/${id}.png`, mime: "image/png", status: "approved", runId: "r", provider: "mock", createdAt: new Date().toISOString(),
      }));
    }
    await store.updateProject(p.id, (q) => void (q.styleGuide = validStyleGuide()));
    const delta = async () => {
      const before = consistencyCacheStats();
      const report = await measureConsistency(await store.loadProject(p.id));
      const after = consistencyCacheStats();
      return { hits: after.hits - before.hits, misses: after.misses - before.misses, report: report! };
    };

    const first = await delta();
    assert.deepEqual([first.hits, first.misses], [0, 2]);
    const second = await delta();
    assert.deepEqual([second.hits, second.misses], [2, 0], "everything from cache");
    assert.deepEqual(second.report, first.report, "same result from cache");

    // A palette edit re-measures everything.
    await store.updateProject(p.id, (q) => void (q.styleGuide = { ...q.styleGuide!, palette: [...q.styleGuide!.palette, { hex: "#ff00ff", role: "accent" }] }));
    const third = await delta();
    assert.deepEqual([third.hits, third.misses], [0, 2]);
    assert.ok(third.report.items.find((i) => i.id === "ast_b")!.coverage > 0.9, "magenta is on-palette now");

    // Rewriting one file re-measures just that one.
    await new Promise((r) => setTimeout(r, 20));
    await store.writeProjectFile(p.id, "assets/ast_a.png", await solidPng(16, 16, "#00ff00"));
    const fourth = await delta();
    assert.deepEqual([fourth.hits, fourth.misses], [1, 1]);
  });
});
