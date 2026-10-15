import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { useTempDataDir } from "./helpers.js";

const dataDir = useTempDataDir();
const store = await import("../src/store/index.js");

async function projectWithFiles() {
  const p = await store.createProject("files");
  const dir = path.join(dataDir, "projects", p.id);
  const touch = (rel: string, size = 10) => fs.writeFileSync(path.join(dir, rel), Buffer.alloc(size));
  for (const f of ["ast_aa.png", "ast_aa_orig.png", "ast_aa_cut1.png", "ast_aa_f0.png", "ast_aa.gif", "ast_aab.png", "ast_zz.png", "stray.tmp"]) touch(`assets/${f}`);
  for (const f of ["ref_1.png", "ref_2.png", "ref_old.png"]) touch(`refs/${f}`);
  const project = await store.updateProject(p.id, (q) => {
    q.refs = [
      { id: "ref_1", file: "refs/ref_1.png", mime: "image/png", originalName: "1" },
      { id: "ref_2", file: "refs/ref_2.png", mime: "image/png", originalName: "2" },
    ];
    q.assets = ["ast_aa", "ast_aab"].map((id) => ({
      id, name: id, assetType: "prop", prompt: "", file: `assets/${id}.png`, mime: "image/png",
      status: "approved" as const, runId: "job", provider: "mock", createdAt: "",
    }));
  });
  const ls = (sub: string) => fs.readdirSync(path.join(dir, sub)).sort();
  return { project, ls };
}

describe("file cleanup", () => {
  it("removes every file an asset owns, and nothing of a similarly named asset", async () => {
    const { project, ls } = await projectWithFiles();
    const r = await store.removeAssetFiles(project.id, ["ast_aa"]);
    assert.equal(r.removed, 5);
    assert.equal(r.bytes, 50);
    assert.deepEqual(ls("assets"), ["ast_aab.png", "ast_zz.png", "stray.tmp"]);
  });

  it("removes a reference's file", async () => {
    const { project, ls } = await projectWithFiles();
    await store.removeRefFile(project.id, "ref_1");
    assert.deepEqual(ls("refs"), ["ref_2.png", "ref_old.png"]);
  });

  it("orphan sweep keeps owned files and removes the rest", async () => {
    const { project, ls } = await projectWithFiles();
    const r = await store.removeOrphanFiles(project);
    assert.equal(r.removed, 3);
    assert.deepEqual(ls("assets"), ["ast_aa.gif", "ast_aa.png", "ast_aa_cut1.png", "ast_aa_f0.png", "ast_aa_orig.png", "ast_aab.png"]);
    assert.deepEqual(ls("refs"), ["ref_1.png", "ref_2.png"]);
    assert.equal((await store.removeOrphanFiles(project)).removed, 0, "idempotent");
  });

  it("reports disk usage of the project folder", async () => {
    const { project } = await projectWithFiles();
    const bytes = await store.projectDiskUsage(project.id);
    const json = fs.statSync(path.join(dataDir, "projects", project.id, "project.json")).size;
    assert.equal(bytes, 11 * 10 + json);
  });
});
