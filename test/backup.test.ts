import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { solidPng, useTempDataDir, validStyleGuide } from "./helpers.js";

const dataDir = useTempDataDir();
const store = await import("../src/store/index.js");
const { createZip } = await import("../src/export/zip.js");
const { readZip } = await import("../src/export/unzip.js");
const { newRunUsage } = await import("../src/usage/index.js");

const meta = { name: "backup-meta.json", data: Buffer.from(JSON.stringify({ format: store.BACKUP_FORMAT, version: 1 })) };
const json = (name: string, v: unknown) => ({ name, data: Buffer.from(JSON.stringify(v)) });

describe("readZip", () => {
  it("round-trips createZip output", () => {
    const entries = [{ name: "a.txt", data: Buffer.from("hello".repeat(100)) }, { name: "b/c.png", data: Buffer.from([1, 2, 3]) }];
    const out = readZip(createZip(entries));
    assert.deepEqual(out.map((e) => [e.name, e.data.toString("hex")]), entries.map((e) => [e.name, e.data.toString("hex")]));
  });

  it("rejects non-zip data and corrupted entries", () => {
    assert.throws(() => readZip(Buffer.from("not a zip at all")), /不是有效的 ZIP/);
    const zip = createZip([{ name: "a.png", data: Buffer.from("abcdef") }]);
    zip[30 + "a.png".length] ^= 0xff; // flip a byte of the stored body
    assert.throws(() => readZip(zip), /校验失败/);
  });

  it("stops a zip bomb at the size limit and caps entry counts", () => {
    const bomb = createZip([{ name: "zeros.json", data: Buffer.alloc(20 * 1024 * 1024) }]);
    assert.ok(bomb.length < 100_000, "compresses well");
    assert.throws(() => readZip(bomb, { maxTotalBytes: 1024 * 1024 }), /超出限制/);
    // A header that understates the size is caught by the inflate cap instead.
    const liar = Buffer.from(bomb);
    const cd = liar.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    liar.writeUInt32LE(10, cd + 24);
    assert.throws(() => readZip(liar, { maxTotalBytes: 1024 * 1024 }));
    const many = createZip(Array.from({ length: 20 }, (_, i) => ({ name: `${i}.txt`, data: Buffer.from("x") })));
    assert.throws(() => readZip(many, { maxEntries: 10 }), /条目过多/);
  });
});

describe("project backup", () => {
  it("restores everything into a new project", async () => {
    const p = await store.createProject("原项目");
    await store.writeProjectFile(p.id, "refs/ref_1.png", await solidPng(8, 8, "#ff0000"));
    await store.writeProjectFile(p.id, "assets/ast_1.png", await solidPng(8, 8, "#00ff00"));
    await store.writeProjectFile(p.id, "assets/ast_1_orig.png", await solidPng(8, 8, "#ffffff"));
    await store.updateProject(p.id, (q) => {
      q.styleGuide = validStyleGuide();
      q.conventions = "图标统一 2px 描边";
      q.refs.push({ id: "ref_1", file: "refs/ref_1.png", mime: "image/png", originalName: "r.png" });
      q.assets.push({ id: "ast_1", name: "剑", assetType: "item_icon", prompt: "p", file: "assets/ast_1.png", mime: "image/png", status: "approved", runId: "job_1", provider: "mock", createdAt: "", originalFile: "assets/ast_1_orig.png" });
    });
    await store.saveConversation(p.id, { messages: [{ role: "user", content: "hi" }], runs: [{ request: "hi", at: "" }] });
    await store.saveRunUsage(p.id, newRunUsage("job_1", "hi", "agent"));
    await store.recordStyleVersion(p.id, validStyleGuide(), "agent");

    const { zip, filename } = await store.buildBackup(p.id);
    assert.equal(filename, "原项目_backup.zip");
    const { project, skipped } = await store.importBackup(zip);
    assert.deepEqual(skipped, []);
    assert.notEqual(project.id, p.id);
    assert.equal(project.name, "原项目（恢复）");
    assert.deepEqual(project.styleGuide, validStyleGuide());
    assert.equal(project.conventions, "图标统一 2px 描边");
    assert.deepEqual(project.assets.map((a) => a.id), ["ast_1"]);
    const dir = path.join(dataDir, "projects", project.id);
    assert.deepEqual(fs.readdirSync(path.join(dir, "assets")).sort(), ["ast_1.png", "ast_1_orig.png"]);
    assert.deepEqual((await store.loadConversation(project.id))!.runs.length, 1);
    assert.equal((await store.loadStyleHistory(project.id)).length, 1);
    assert.equal((await store.loadUsage(project.id))[0].status, "interrupted", "a run that was in progress cannot resume");
    assert.deepEqual(await store.loadProject(project.id), project);
  });

  it("ignores unsafe paths, drops assets without files and clears an invalid style guide", async () => {
    const zip = createZip([
      meta,
      json("project.json", {
        name: "evil",
        styleGuide: { summary: "x" },
        refs: [{ id: "ref_a", file: "refs/a.png", mime: "image/png", originalName: "a" }, { id: "ref_b", file: "../../outside.png", mime: "image/png", originalName: "b" }],
        assets: [
          { id: "ast_ok", name: "ok", assetType: "prop", prompt: "", file: "assets/ast_ok.png", mime: "image/png", status: "approved", runId: "", provider: "", createdAt: "" },
          { id: "ast_missing", name: "missing", assetType: "prop", prompt: "", file: "assets/ast_missing.png", mime: "image/png", status: "approved", runId: "", provider: "", createdAt: "" },
        ],
      }),
      { name: "refs/a.png", data: Buffer.from("a") },
      { name: "assets/ast_ok.png", data: Buffer.from("ok") },
      { name: "../../outside.png", data: Buffer.from("evil") },
      { name: "assets/../../escape.png", data: Buffer.from("evil") },
      { name: "refs/nested/deep.png", data: Buffer.from("evil") },
      { name: "conversation.json", data: Buffer.from("{not json") },
    ]);
    const { project, skipped } = await store.importBackup(zip);
    assert.deepEqual(project.refs.map((r) => r.id), ["ref_a"]);
    assert.deepEqual(project.assets.map((a) => a.id), ["ast_ok"]);
    assert.equal(project.styleGuide, null);
    assert.deepEqual(skipped.sort(), ["参考图 ref_b", "素材 missing", "风格指南（格式无效）"].sort());
    assert.ok(!fs.existsSync(path.join(dataDir, "outside.png")));
    assert.ok(!fs.existsSync(path.join(dataDir, "projects", "escape.png")));
    assert.ok(!fs.existsSync(path.join(dataDir, "projects", project.id, "conversation.json")), "invalid JSON is not restored");
  });

  it("drops frame / gif / original paths that point outside the backup (path traversal)", async () => {
    const asset = (id: string, extra: object) => ({
      id, name: id, assetType: "sprite_sheet", prompt: "", file: `assets/${id}.png`, mime: "image/png",
      status: "approved", runId: "", provider: "", createdAt: "", ...extra,
    });
    const zip = createZip([
      meta,
      json("project.json", {
        name: "evil", refs: [],
        assets: [
          asset("ast_a", { frames: ["../../SECRET.txt"], gif: "assets/ast_a.gif" }),
          asset("ast_b", { gif: "../x.gif", originalFile: "/etc/passwd" }),
          asset("ast_c", { frames: ["assets/ast_c_f0.png"], gif: "assets/ast_c.gif", originalFile: "assets/ast_c_orig.png" }),
        ],
      }),
      ...["ast_a.png", "ast_a.gif", "ast_b.png", "ast_c.png", "ast_c_f0.png", "ast_c.gif", "ast_c_orig.png"].map((n) => ({ name: `assets/${n}`, data: Buffer.from("x") })),
    ]);
    const { project } = await store.importBackup(zip);
    const [a, b, c] = project.assets;
    assert.deepEqual([a.frames, a.gif], [undefined, undefined], "frames dropped, and the gif with them");
    assert.deepEqual([b.gif, b.originalFile], [undefined, undefined]);
    assert.deepEqual([c.frames, c.gif, c.originalFile], [["assets/ast_c_f0.png"], "assets/ast_c.gif", "assets/ast_c_orig.png"], "valid paths are kept");
  });

  it("refuses archives that are not project backups", async () => {
    await assert.rejects(store.importBackup(createZip([json("project.json", { refs: [], assets: [] })])), /不是本工具导出的项目备份/);
    await assert.rejects(store.importBackup(createZip([meta, json("project.json", { refs: "nope" })])), /project.json 无效/);
  });
});
