import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";
import { useTempDataDir } from "./helpers.js";

const dataDir = useTempDataDir();
const store = await import("../src/store/index.js");
const { newRunUsage } = await import("../src/usage/index.js");

describe("projects", () => {
  it("creates a project with its folders and reads it back", async () => {
    const p = await store.createProject("测试项目");
    assert.match(p.id, /^prj_[0-9a-f]{10}$/);
    assert.ok(fs.existsSync(path.join(dataDir, "projects", p.id, "refs")));
    assert.ok(fs.existsSync(path.join(dataDir, "projects", p.id, "assets")));
    assert.deepEqual(await store.loadProject(p.id), p);
  });

  it("names an unnamed project", async () => {
    assert.equal((await store.createProject("")).name, "未命名项目");
  });

  it("lists projects newest first and skips broken ones", async () => {
    const a = await store.createProject("a");
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.createProject("b");
    fs.mkdirSync(path.join(dataDir, "projects", "prj_deadbeef00"));
    const ids = (await store.listProjects()).map((p) => p.id);
    assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));
    assert.ok(!ids.includes("prj_deadbeef00"));
  });

  it("serializes concurrent updates so none are lost", async () => {
    const p = await store.createProject("race");
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.updateProject(p.id, async (q) => {
          await new Promise((r) => setTimeout(r, Math.random() * 3));
          q.refs.push({ id: `ref_${i}`, file: `refs/${i}.png`, mime: "image/png", originalName: `${i}.png` });
        }),
      ),
    );
    assert.equal((await store.loadProject(p.id)).refs.length, 25);
  });

  it("a failing update does not block later ones", async () => {
    const p = await store.createProject("err");
    await assert.rejects(store.updateProject(p.id, () => { throw new Error("boom"); }));
    const q = await store.updateProject(p.id, (x) => void (x.name = "after"));
    assert.equal(q.name, "after");
  });

  it("deletes a project directory", async () => {
    const p = await store.createProject("gone");
    await store.deleteProject(p.id);
    await assert.rejects(store.loadProject(p.id), { code: "ENOENT" });
  });

  it("rejects ids that could escape the data directory", () => {
    for (const bad of ["../etc", "prj_../x", "prj_ABC", "prj_", "foo"]) {
      assert.throws(() => store.projectDir(bad), /invalid project id/);
    }
  });

  it("refuses project file paths outside refs/ and assets/", async () => {
    const p = await store.createProject("paths");
    for (const bad of ["../x", "assets/../../x", "assets/a/b.png", "project.json", "/etc/passwd", "assets/..", "thumbs/a.png"]) {
      await assert.rejects(store.readProjectFile(p.id, bad), /invalid project file path/, bad);
      await assert.rejects(store.writeProjectFile(p.id, bad, Buffer.from("x")), /invalid project file path/, bad);
    }
  });

  it("reads and writes project files; maps mime to extension", async () => {
    const p = await store.createProject("files");
    await store.writeProjectFile(p.id, "assets/x.bin", Buffer.from("hello"));
    assert.equal((await store.readProjectFile(p.id, "assets/x.bin")).toString(), "hello");
    assert.equal(store.extFor("image/jpeg"), "jpg");
    assert.equal(store.extFor("image/webp"), "webp");
    assert.equal(store.extFor("application/octet-stream"), "png");
  });
});

describe("conversation", () => {
  let id: string;
  before(async () => {
    id = (await store.createProject("conv")).id;
  });

  it("is null before anything is saved", async () => {
    assert.equal(await store.loadConversation(id), null);
    assert.equal(await store.conversationSize(id), 0);
  });

  it("round-trips and clears", async () => {
    const conv = { messages: [{ role: "user", content: "hi" }], runs: [{ request: "hi", at: "2026-01-01T00:00:00Z" }] };
    const bytes = await store.saveConversation(id, conv);
    assert.equal(bytes, JSON.stringify(conv).length);
    assert.deepEqual(await store.loadConversation(id), conv);
    assert.equal(await store.conversationSize(id), bytes);
    await store.clearConversation(id);
    assert.equal(await store.loadConversation(id), null);
  });
});

describe("usage log", () => {
  it("ignores malformed entries (e.g. from an imported backup)", async () => {
    const { id } = await store.createProject("bad-usage");
    fs.writeFileSync(path.join(dataDir, "projects", id, "usage.json"), JSON.stringify([null, 5, { jobId: "x" }, newRunUsage("job_ok", "", "demo")]));
    assert.deepEqual((await store.loadUsage(id)).map((r) => r.jobId), ["job_ok"]);
  });

  it("upserts runs by job id, serialized per project", async () => {
    const { id } = await store.createProject("usage");
    assert.deepEqual(await store.loadUsage(id), []);
    const a = newRunUsage("job_a", "first", "demo");
    const b = newRunUsage("job_b", "second", "demo");
    await Promise.all([store.saveRunUsage(id, a), store.saveRunUsage(id, b)]);
    a.status = "ok";
    await store.saveRunUsage(id, a);
    const list = await store.loadUsage(id);
    assert.deepEqual(list.map((r) => [r.jobId, r.status]), [["job_a", "ok"], ["job_b", "running"]]);
  });
});

describe("keyed queue", () => {
  it("drain waits for queued work and the key map empties afterwards", async () => {
    const { createKeyedQueue } = await import("../src/store/fs.js");
    const q = createKeyedQueue();
    const order: number[] = [];
    void q("a", async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); });
    void q("a", async () => { order.push(2); });
    void q("b", async () => { throw new Error("ignored"); }).catch(() => undefined);
    await q.drain();
    assert.deepEqual(order, [1, 2]);
    await q.drain(); // nothing pending: resolves immediately
  });
});
