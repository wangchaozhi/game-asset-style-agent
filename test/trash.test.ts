import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { solidPng, useTempDataDir } from "./helpers.js";

const dataDir = useTempDataDir();
const store = await import("../src/store/index.js");

const asset = (id: string) => ({
  id, name: id, assetType: "prop", prompt: "", file: `assets/${id}.png`, mime: "image/png",
  status: "approved" as const, runId: "", provider: "mock", createdAt: "",
});

async function project(ids: string[]) {
  const p = await store.createProject("trash");
  for (const id of ids) await store.writeProjectFile(p.id, `assets/${id}.png`, await solidPng(4, 4, "#000000"));
  return store.updateProject(p.id, (q) => void (q.assets = ids.map(asset)));
}

describe("trash", () => {
  it("moves, restores and purges", () => {
    const p: import("../src/store/types.js").Project = { id: "prj_x", name: "", createdAt: "", refs: [], styleGuide: null, assets: ["a", "b", "c"].map(asset) };
    assert.equal(store.moveToTrash(p, new Set(["a", "b", "zz"]), "2026-01-01T00:00:00Z"), 2);
    assert.deepEqual(p.assets.map((a) => a.id), ["c"]);
    assert.deepEqual(p.trash!.map((a) => [a.id, a.deletedAt]), [["a", "2026-01-01T00:00:00Z"], ["b", "2026-01-01T00:00:00Z"]]);
    assert.equal(store.restoreFromTrash(p, new Set(["a"])), 1);
    assert.ok(!("deletedAt" in p.assets.find((a) => a.id === "a")!), "restored assets drop deletedAt");
    assert.deepEqual(store.takeForPurge(p, new Set(["b", "c"])).sort(), ["b", "c"]);
    assert.deepEqual([p.assets.map((a) => a.id), p.trash!.length], [["a"], 0]);
  });

  it("auto-purges items older than TRASH_DAYS, with their files", async () => {
    const p = await project(["ast_old", "ast_new"]);
    const now = Date.parse("2026-03-10T00:00:00Z");
    await store.updateProject(p.id, (q) => {
      store.moveToTrash(q, new Set(["ast_old"]), "2026-03-01T00:00:00Z");
      store.moveToTrash(q, new Set(["ast_new"]), "2026-03-09T00:00:00Z");
    });
    assert.equal(await store.purgeExpiredTrash(7, now), 1);
    const after = await store.loadProject(p.id);
    assert.deepEqual(after.trash!.map((a) => a.id), ["ast_new"]);
    const files = fs.readdirSync(path.join(dataDir, "projects", p.id, "assets"));
    assert.deepEqual(files, ["ast_new.png"]);
  });

  it("is kept by backups", async () => {
    const p = await project(["ast_t"]);
    await store.updateProject(p.id, (q) => void store.moveToTrash(q, new Set(["ast_t"])));
    const { project: restored } = await store.importBackup((await store.buildBackup(p.id)).zip);
    assert.deepEqual(restored.trash!.map((a) => a.id), ["ast_t"]);
  });
});
