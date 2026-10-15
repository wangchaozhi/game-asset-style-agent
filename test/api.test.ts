import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { readZip, solidPng, useTempDataDir, validStyleGuide } from "./helpers.js";

const dataDir = useTempDataDir();
process.env.AGENT_MODE = "demo";
const assetFiles = (projectId: string, assetId: string) =>
  fs.readdirSync(path.join(dataDir, "projects", projectId, "assets")).filter((f) => f.startsWith(`${assetId}.`) || f.startsWith(`${assetId}_`));
const { createApp } = await import("../src/app.js");

let base = "";
let server: import("node:http").Server;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const json = async (path: string, init?: Omit<RequestInit, "body"> & { body?: unknown }) => {
  const res = await fetch(base + path, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: init?.body instanceof FormData ? init.body : init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** Read the SSE stream until "done" and return the parsed events. */
async function events(jobId: string) {
  const res = await fetch(`${base}/api/jobs/${jobId}/events`);
  const text = await res.text();
  return text.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
}

describe("HTTP API (demo mode)", () => {
  let id = "";

  it("serves config and the UI", async () => {
    const { body } = await json("/api/config");
    assert.equal(body.demo, true);
    assert.ok(body.providers.some((p: { id: string; available: boolean }) => p.id === "mock" && p.available));
    assert.ok("item_icon" in body.assetTypes);
    assert.equal(body.budget.maxImages, 40);
    const page = await fetch(base + "/");
    assert.match(await page.text(), /js\/main\.js/);
    assert.match(page.headers.get("content-security-policy")!, /script-src 'self'/);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("x-powered-by"), null);
  });

  it("creates a project and uploads a reference", async () => {
    id = (await json("/api/projects", { method: "POST", body: { name: "API" } })).body.id;
    const fd = new FormData();
    fd.append("images", new Blob([new Uint8Array(await solidPng(40, 40, "#22aa66"))], { type: "image/png" }), "ref.png");
    const { status, body } = await json(`/api/projects/${id}/refs`, { method: "POST", body: fd });
    assert.equal(status, 200);
    assert.equal(body.refs.length, 1);
  });

  it("sets and clears reference notes", async () => {
    const ref = (await json(`/api/projects/${id}`)).body.refs[0];
    const set = await json(`/api/projects/${id}/refs/${ref.id}`, { method: "PATCH", body: { note: "  只参考配色  " } });
    assert.equal(set.body.refs[0].note, "只参考配色");
    const cleared = await json(`/api/projects/${id}/refs/${ref.id}`, { method: "PATCH", body: { note: "" } });
    assert.equal("note" in cleared.body.refs[0], false);
    assert.equal((await json(`/api/projects/${id}/refs/ref_nope`, { method: "PATCH", body: { note: "x" } })).status, 404);
    assert.equal((await json(`/api/projects/${id}/refs/${ref.id}`, { method: "PATCH", body: { note: 5 } })).status, 400);
  });

  it("validates style guide edits", async () => {
    const bad = await json(`/api/projects/${id}/style-guide`, { method: "PUT", body: { ...validStyleGuide(), palette: [] } });
    assert.equal(bad.status, 400);
    const ok = await json(`/api/projects/${id}/style-guide`, { method: "PUT", body: validStyleGuide() });
    assert.equal(ok.body.styleGuide.summary, "Cozy pixel art");
  });

  it("keeps a style guide history that can be restored", async () => {
    await json(`/api/projects/${id}/style-guide`, { method: "PUT", body: { ...validStyleGuide(), mood: "grim" } });
    let hist = (await json(`/api/projects/${id}/style-history`)).body;
    assert.deepEqual(hist.map((v: { source: string; changed: string[] }) => [v.source, v.changed]), [["user", []], ["user", ["mood"]]]);
    const restored = await json(`/api/projects/${id}/style-history/${hist[1].index}/restore`, { method: "POST" });
    assert.equal(restored.body.styleGuide.mood, validStyleGuide().mood);
    hist = (await json(`/api/projects/${id}/style-history`)).body;
    assert.equal(hist[0].source, "restore");
    assert.equal((await json(`/api/projects/${id}/style-history/99/restore`, { method: "POST" })).status, 404);
    // clearing keeps the guide restorable
    await json(`/api/projects/${id}`, { method: "PATCH", body: { resetStyle: true } });
    hist = (await json(`/api/projects/${id}/style-history`)).body;
    assert.ok(hist.length >= 3);
    await json(`/api/projects/${id}/style-history/${hist[0].index}/restore`, { method: "POST" });
    assert.ok((await json(`/api/projects/${id}`)).body.styleGuide);
  });

  it("runs a demo job end to end and records usage", async () => {
    const run = await json(`/api/projects/${id}/run`, { method: "POST", body: { request: "道具", assetTypes: ["item_icon", "tile"], provider: "mock" } });
    assert.equal(run.status, 200);
    const evs = await events(run.body.jobId);
    const kinds = evs.map((e) => e.type);
    assert.equal(kinds.at(-1), "done");
    const lastUsage = evs.filter((e) => e.type === "usage").at(-1);
    assert.deepEqual([lastUsage.usage.status, lastUsage.usage.images.calls], ["ok", 2]);
    // Reconnecting after the run replays the log with only the latest usage snapshot.
    const replay = await events(run.body.jobId);
    assert.equal(replay.filter((e) => e.type === "usage").length, 1);
    assert.equal(replay.at(-1).type, "done");
    assert.ok(!kinds.includes("error"), JSON.stringify(evs.filter((e) => e.type === "error")));
    const project = (await json(`/api/projects/${id}`)).body;
    assert.equal(project.assets.length, 2);
    assert.ok(project.assets.every((a: { status: string }) => a.status === "approved"));

    const usage = (await json(`/api/projects/${id}/usage`)).body;
    assert.equal(usage.runs.length, 1);
    assert.equal(usage.runs[0].status, "ok");
    assert.equal(usage.runs[0].mode, "demo");
    assert.equal(usage.summary.images.calls, 2);
    assert.equal(usage.summary.cost.total, 0);
  });

  it("serves asset files, sized PNGs and tile checks; blocks path tricks", async () => {
    const project = (await json(`/api/projects/${id}`)).body;
    const tile = project.assets.find((a: { assetType: string }) => a.assetType === "tile");
    assert.equal((await fetch(`${base}/api/projects/${id}/files/${tile.file}`)).status, 200);
    const thumb = await fetch(`${base}/api/projects/${id}/thumbs/${tile.file}?w=160`);
    assert.equal(thumb.headers.get("content-type"), "image/webp");
    const etag = thumb.headers.get("etag")!;
    // fetch() adds "cache-control: no-cache" to conditional requests, so revalidate the way a browser cache does.
    const revalidated = await new Promise<number>((resolve, reject) =>
      http.get(`${base}/api/projects/${id}/thumbs/${tile.file}?w=160`, { headers: { "if-none-match": etag } }, (r) => (r.resume(), resolve(r.statusCode!))).on("error", reject),
    );
    assert.equal(revalidated, 304);
    assert.equal((await fetch(`${base}/api/projects/${id}/thumbs/${tile.file}?w=999`)).status, 400);
    assert.equal((await fetch(`${base}/api/projects/${id}/thumbs/project.json`)).status, 400);
    assert.equal((await fetch(`${base}/api/projects/${id}/files/project.json`)).status, 400);
    assert.equal((await fetch(`${base}/api/projects/${id}/files/assets/..%2Fproject.json`)).status, 400);
    const sized = await fetch(`${base}/api/projects/${id}/assets/${tile.id}/sized.png?size=32`);
    assert.equal(sized.headers.get("content-type"), "image/png");
    assert.equal((await json(`/api/projects/${id}/assets/${tile.id}/sized.png?size=1`)).status, 400);
    const seams = (await json(`/api/projects/${id}/assets/${tile.id}/seams`)).body;
    assert.equal(typeof seams.seamless, "boolean");
    const fixed = await json(`/api/projects/${id}/assets/${tile.id}/make-seamless`, { method: "POST", body: { overlap: 0.2 } });
    assert.deepEqual([fixed.body.parentId, fixed.body.status, fixed.body.provider], [tile.id, "pending_review", "postprocess"]);
    assert.equal((await json(`/api/projects/${id}/assets/${fixed.body.id}/seams`)).body.seamless, true);
    assert.equal((await json(`/api/projects/${id}/assets/${tile.id}/make-seamless`, { method: "POST", body: { overlap: 0.9 } })).status, 400);
    assert.equal((await json(`/api/projects/${id}/assets/ast_missing/seams`)).status, 404);
    const pal = (await json(`/api/projects/${id}/assets/${tile.id}/palette?threshold=25`)).body;
    assert.equal(pal.threshold, 25);
    assert.equal(pal.usage.length, 3);
  });

  it("manual review updates status and rejects bad values", async () => {
    const asset = (await json(`/api/projects/${id}`)).body.assets[0];
    const r = await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: { status: "rejected", notes: "太亮" } });
    assert.deepEqual([r.body.status, r.body.notes, r.body.reviewer], ["rejected", "太亮", "user"]);
    assert.equal((await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: { status: "great" } })).status, 400);
  });

  it("renames an asset without touching its review", async () => {
    const asset = (await json(`/api/projects/${id}`)).body.assets[0];
    const r = await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: { name: "  火焰剑 v2  " } });
    assert.deepEqual([r.body.name, r.body.status], ["火焰剑 v2", asset.status]);
    assert.equal((await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: { name: "  " } })).status, 400);
    assert.equal((await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: {} })).status, 400);
  });

  it("exports approved assets as a ZIP", async () => {
    const res = await fetch(`${base}/api/projects/${id}/export.zip`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    const zip = Buffer.from(await res.arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.ok(zip.includes(Buffer.from("manifest.json")));
  });

  it("exports a texture atlas with Phaser animations, and Godot .tres for sprite sheets", async () => {
    const run = await json(`/api/projects/${id}/run`, { method: "POST", body: { request: "走路", assetTypes: ["sprite_sheet", "background"], provider: "mock" } });
    await events(run.body.jobId);
    // The mock's walk cycle bobs up and down: frame alignment flattens it into a new version.
    const sheet = (await json(`/api/projects/${id}`)).body.assets.find((a: { assetType: string }) => a.assetType === "sprite_sheet");
    const jitter = (await json(`/api/projects/${id}/assets/${sheet.id}/jitter`)).body;
    assert.ok(jitter.vertical > 10, JSON.stringify(jitter));
    const aligned = (await json(`/api/projects/${id}/assets/${sheet.id}/align-frames`, { method: "POST", body: { mode: "bottom" } })).body;
    assert.equal(aligned.after.vertical, 0);
    assert.deepEqual([aligned.asset.parentId, aligned.asset.frames.length, !!aligned.asset.gif], [sheet.id, 4, true]);
    assert.equal((await json(`/api/projects/${id}/assets/${aligned.asset.id}/jitter`)).body.vertical, 0);
    await json(`/api/projects/${id}/assets/${aligned.asset.id}`, { method: "DELETE" });
    const tile = (await json(`/api/projects/${id}`)).body.assets.find((a: { assetType: string }) => a.assetType === "background");
    assert.equal((await json(`/api/projects/${id}/assets/${tile.id}/jitter`)).status, 400);
    const atlasRes = await fetch(`${base}/api/projects/${id}/export-atlas.zip?max=64`);
    assert.equal(atlasRes.status, 200);
    const atlas = readZip(Buffer.from(await atlasRes.arrayBuffer()));
    assert.ok(atlas["atlas.png"] && atlas["atlas.json"] && atlas["animations.json"] && atlas["README.txt"], Object.keys(atlas).join());
    const frames = Object.keys(JSON.parse(atlas["atlas.json"].data.toString()).frames);
    assert.ok(!frames.some((f) => f.startsWith("background/")), "backgrounds stay out of the atlas");
    const anims = JSON.parse(atlas["animations.json"].data.toString()).anims;
    assert.equal(anims.length, 1);
    assert.equal(anims[0].frames.length, 4);
    assert.ok(anims[0].frames.every((f: { key: string; frame: string }) => f.key === "atlas" && frames.includes(f.frame)));

    const bundle = readZip(Buffer.from(await (await fetch(`${base}/api/projects/${id}/export.zip?godot=game/art`)).arrayBuffer()));
    const tres = Object.keys(bundle).find((n) => n.endsWith(".tres"))!;
    assert.match(bundle[tres].data.toString(), /res:\/\/game\/art\/sprite_sheet\//);
    const manifest = JSON.parse(bundle["manifest.json"].data.toString());
    assert.ok(manifest.assets.some((a: { files: { godot?: string } }) => a.files.godot === tres));

    assert.equal((await json(`/api/projects/${id}/export-atlas.zip?max=9999`)).status, 400);
    assert.equal((await json(`/api/projects/${id}/export-atlas.zip?size=300`)).status, 400);
  });

  it("batch-updates, exports by id, and batch-deletes", async () => {
    const ids = (await json(`/api/projects/${id}`)).body.assets.map((a: { id: string }) => a.id);
    assert.ok(ids.length >= 3);
    const rej = await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "reject", ids: [ids[0], ids[1], "ast_missing"] } });
    assert.equal(rej.body.affected, 2);
    const byId = Object.fromEntries(rej.body.project.assets.map((a: { id: string; status: string; reviewer: string }) => [a.id, a]));
    assert.deepEqual([byId[ids[0]].status, byId[ids[0]].reviewer, byId[ids[1]].status], ["rejected", "user", "rejected"]);

    // ids pick assets regardless of status
    const zip = readZip(Buffer.from(await (await fetch(`${base}/api/projects/${id}/export.zip?ids=${ids[0]}`)).arrayBuffer()));
    const manifest = JSON.parse(zip["manifest.json"].data.toString());
    assert.deepEqual(manifest.assets.map((a: { id: string }) => a.id), [ids[0]]);
    assert.equal((await json(`/api/projects/${id}/export.zip?ids=ast_missing`)).status, 400);

    assert.ok(assetFiles(id, ids[0]).length > 0);
    // delete → trash: off the library, files kept
    const del = await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "delete", ids: [ids[0]] } });
    assert.equal(del.body.affected, 1);
    assert.ok(!del.body.project.assets.some((a: { id: string }) => a.id === ids[0]));
    const trashed = del.body.project.trash.find((a: { id: string }) => a.id === ids[0]);
    assert.ok(trashed?.deletedAt);
    assert.ok(assetFiles(id, ids[0]).length > 0, "files stay while in the trash");
    // the orphan sweep leaves trashed files alone
    assert.equal((await json(`/api/projects/${id}/cleanup`, { method: "POST" })).body.removed, 0);
    // restore → back in the library
    const back = await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "restore", ids: [ids[0]] } });
    assert.ok(back.body.project.assets.some((a: { id: string; deletedAt?: string }) => a.id === ids[0] && !a.deletedAt));
    assert.ok(!back.body.project.trash.some((a: { id: string }) => a.id === ids[0]));
    // purge → gone for good
    await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "delete", ids: [ids[0]] } });
    const purge = await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "purge", ids: [ids[0]] } });
    assert.equal(purge.body.affected, 1);
    assert.deepEqual(assetFiles(id, ids[0]), [], "purged files are gone");

    for (const bad of [{ action: "explode", ids }, { action: "approve", ids: [] }, { action: "approve", ids: [1, 2] }, { action: "approve" }]) {
      assert.equal((await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: bad })).status, 400, JSON.stringify(bad));
    }
  });

  it("re-cutting keeps only the latest cut-out; deleting removes all files; cleanup sweeps strays", async () => {
    const asset = (await json(`/api/projects/${id}`)).body.assets.find((a: { assetType: string }) => a.assetType !== "background");
    await json(`/api/projects/${id}/assets/${asset.id}/cutout`, { method: "POST", body: { tolerance: 20 } });
    await json(`/api/projects/${id}/assets/${asset.id}/cutout`, { method: "POST", body: { tolerance: 40 } });
    assert.equal(assetFiles(id, asset.id).filter((f) => f.includes("_cut")).length, 1);
    assert.ok(assetFiles(id, asset.id).some((f) => f.includes("_orig")));

    const before = (await json(`/api/projects/${id}/storage`)).body.bytes;
    fs.writeFileSync(path.join(dataDir, "projects", id, "assets", "leftover.png"), Buffer.alloc(1000));
    assert.equal((await json(`/api/projects/${id}/storage`)).body.bytes, before + 1000);
    const swept = (await json(`/api/projects/${id}/cleanup`, { method: "POST" })).body;
    assert.deepEqual([swept.removed, swept.bytes], [1, 1000]);

    await json(`/api/projects/${id}/assets/${asset.id}`, { method: "DELETE" });
    assert.ok(assetFiles(id, asset.id).length > 0, "moved to the trash, files kept");
    const emptied = (await json(`/api/projects/${id}/trash/empty`, { method: "POST" })).body;
    assert.ok(emptied.affected >= 1);
    assert.deepEqual(emptied.project.trash, []);
    assert.deepEqual(assetFiles(id, asset.id), []);
    // ?permanent=1 skips the trash
    const other = (await json(`/api/projects/${id}`)).body.assets[0];
    await json(`/api/projects/${id}/assets/${other.id}?permanent=1`, { method: "DELETE" });
    assert.deepEqual(assetFiles(id, other.id), []);
    assert.ok(!(await json(`/api/projects/${id}`)).body.trash?.some((a: { id: string }) => a.id === other.id));
  });

  it("deleting a reference removes its file", async () => {
    const project = (await json(`/api/projects/${id}`)).body;
    const ref = project.refs[0];
    assert.ok(fs.existsSync(path.join(dataDir, "projects", id, ref.file)));
    await json(`/api/projects/${id}/refs/${ref.id}`, { method: "DELETE" });
    assert.ok(!fs.existsSync(path.join(dataDir, "projects", id, ref.file)));
  });

  it("demo runs respect the per-run image budget", async () => {
    const fd = new FormData();
    fd.append("images", new Blob([new Uint8Array(await solidPng(40, 40, "#22aa66"))], { type: "image/png" }), "ref.png");
    await json(`/api/projects/${id}/refs`, { method: "POST", body: fd });
    const run = await json(`/api/projects/${id}/run`, { method: "POST", body: { assetTypes: ["prop", "ui", "vfx"], provider: "mock", budget: { maxImages: 2 } } });
    const evs = await events(run.body.jobId);
    assert.ok(!evs.some((e) => e.type === "error"));
    const usage = (await json(`/api/projects/${id}/usage`)).body.runs[0];
    assert.deepEqual([usage.images.calls, usage.budget.maxImages, usage.status], [2, 2, "ok"]);
  });

  it("backs a project up and restores it as a new one", async () => {
    const res = await fetch(`${base}/api/projects/${id}/backup.zip`);
    assert.equal(res.status, 200);
    const fd = new FormData();
    fd.append("backup", new Blob([new Uint8Array(await res.arrayBuffer())], { type: "application/zip" }), "b.zip");
    const imported = await json("/api/projects/import", { method: "POST", body: fd });
    assert.equal(imported.status, 200);
    const original = (await json(`/api/projects/${id}`)).body;
    assert.notEqual(imported.body.project.id, id);
    assert.equal(imported.body.project.assets.length, original.assets.length);
    const bad = new FormData();
    bad.append("backup", new Blob([new Uint8Array([1, 2, 3])]), "x.zip");
    assert.equal((await json("/api/projects/import", { method: "POST", body: bad })).status, 400);
  });

  it("regenerates an asset from an edited prompt as a job", async () => {
    const asset = (await json(`/api/projects/${id}`)).body.assets[0];
    const r = await json(`/api/projects/${id}/assets/${asset.id}/regenerate`, { method: "POST", body: { prompt: "A brand new prompt for this icon, bold", provider: "mock" } });
    assert.equal(r.status, 200);
    const evs = await events(r.body.jobId);
    assert.ok(!evs.some((e) => e.type === "error"), JSON.stringify(evs.filter((e) => e.type === "error")));
    const created = (await json(`/api/projects/${id}`)).body.assets.at(-1);
    assert.deepEqual([created.parentId, created.prompt], [asset.id, "A brand new prompt for this icon, bold"]);
    assert.equal((await json(`/api/projects/${id}/assets/${asset.id}/regenerate`, { method: "POST", body: { prompt: "short" } })).status, 400);
    assert.equal((await json(`/api/projects/${id}/assets/ast_nope/regenerate`, { method: "POST", body: { prompt: "long enough prompt here" } })).status, 404);
  });

  it("re-slices sprite sheets and renders tiled previews", async () => {
    const run = await json(`/api/projects/${id}/run`, { method: "POST", body: { assetTypes: ["sprite_sheet", "tile"], provider: "mock" } });
    await events(run.body.jobId);
    const assets = (await json(`/api/projects/${id}`)).body.assets;
    const sheet = assets.findLast((a: { assetType: string }) => a.assetType === "sprite_sheet");
    const sliced = await json(`/api/projects/${id}/assets/${sheet.id}/slice`, { method: "POST", body: { frames: 6, fps: 12 } });
    assert.deepEqual([sliced.body.frames.length, sliced.body.fps], [6, 12]);
    assert.equal((await json(`/api/projects/${id}/assets/${sheet.id}/slice`, { method: "POST", body: { frames: 40 } })).status, 400);
    const tile = assets.findLast((a: { assetType: string }) => a.assetType === "tile");
    const tiled = await fetch(`${base}/api/projects/${id}/assets/${tile.id}/tiled.png?n=2`);
    const { default: sharp } = await import("sharp");
    const meta = await sharp(Buffer.from(await tiled.arrayBuffer())).metadata();
    assert.deepEqual([meta.width, meta.height], [1024, 1024]);
    assert.equal((await json(`/api/projects/${id}/assets/${tile.id}/tiled.png?n=9`)).status, 400);
  });

  it("redraws an asset in demo mode as a linked version", async () => {
    const asset = (await json(`/api/projects/${id}`)).body.assets[0];
    const r = await json(`/api/projects/${id}/run`, { method: "POST", body: { redraw: { assetId: asset.id, feedback: "更亮" }, provider: "mock" } });
    const evs = await events(r.body.jobId);
    assert.ok(!evs.some((e) => e.type === "error"));
    const created = (await json(`/api/projects/${id}`)).body.assets.at(-1);
    assert.equal(created.parentId, asset.id);
    assert.match(created.prompt, /Revision: 更亮$/);
  });

  it("stops a running job; a second run is refused while one is active", async () => {
    process.env.MOCK_DELAY_MS = "5000";
    try {
      const r = await json(`/api/projects/${id}/run`, { method: "POST", body: { assetTypes: ["prop"], provider: "mock" } });
      const busy = await json(`/api/projects/${id}/run`, { method: "POST", body: { assetTypes: ["prop"], provider: "mock" } });
      assert.deepEqual([busy.status, busy.body.jobId], [409, r.body.jobId]);
      await new Promise((res) => setTimeout(res, 50));
      await json(`/api/jobs/${r.body.jobId}/stop`, { method: "POST" });
      const evs = await events(r.body.jobId);
      assert.ok(evs.some((e) => e.type === "status" && e.text === "已停止"));
      const run = (await json(`/api/projects/${id}/usage`)).body.runs.find((x: { jobId: string }) => x.jobId === r.body.jobId);
      assert.equal(run.status, "stopped");
    } finally {
      process.env.MOCK_DELAY_MS = "0";
    }
  });

  it("returns 404 for unknown projects and jobs", async () => {
    assert.equal((await json("/api/projects/prj_0000000000")).status, 404);
    assert.equal((await fetch(`${base}/api/jobs/job_nope/events`)).status, 404);
    assert.equal((await json("/api/projects/not-an-id")).status, 500);
  });
});
