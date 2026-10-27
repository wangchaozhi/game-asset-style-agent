import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
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
    // fetch() normalises "..", even percent-encoded; send the raw path the way a hostile client would.
    const rawStatus = (p: string) =>
      new Promise<number>((resolve, reject) => {
        const u = new URL(base);
        http.get({ host: u.hostname, port: u.port, path: p }, (r) => (r.resume(), resolve(r.statusCode!))).on("error", reject);
      });
    for (const route of ["files", "thumbs"]) {
      assert.equal(await rawStatus(`/api/projects/${id}/${route}/assets/..`), 400, route);
      assert.equal(await rawStatus(`/api/projects/${id}/${route}/assets/%2E%2E`), 400, route);
      assert.equal(await rawStatus(`/api/projects/${id}/${route}/assets/..%2Fproject.json`), 400, route);
    }
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
    const snapped = (await json(`/api/projects/${id}/assets/${tile.id}/snap-palette`, { method: "POST", body: { dither: "ordered" } })).body;
    assert.deepEqual([snapped.asset.parentId, snapped.after.coverage], [tile.id, 1]);
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

  it("tags assets, filters exports by tag, and batch-adds / removes tags", async () => {
    const [a, b] = (await json(`/api/projects/${id}`)).body.assets;
    const set = await json(`/api/projects/${id}/assets/${a.id}`, { method: "PATCH", body: { tags: [" 第一关 ", "第一关", "Boss"] } });
    assert.deepEqual(set.body.tags, ["第一关", "Boss"]);
    const batch = await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "tag", ids: [a.id, b.id], tags: ["UI"] } });
    assert.equal(batch.body.affected, 2);
    const byId = Object.fromEntries(batch.body.project.assets.map((x: { id: string; tags?: string[] }) => [x.id, x.tags]));
    assert.deepEqual([byId[a.id], byId[b.id]], [["第一关", "Boss", "UI"], ["UI"]]);
    assert.equal((await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "tag", ids: [a.id] } })).status, 400);
    // export only the tagged subset (any status, via status=all)
    const zip = readZip(Buffer.from(await (await fetch(`${base}/api/projects/${id}/export.zip?status=all&tag=boss`)).arrayBuffer()));
    const manifest = JSON.parse(zip["manifest.json"].data.toString());
    assert.deepEqual(manifest.assets.map((x: { id: string; tags: string[] }) => [x.id, x.tags]), [[a.id, ["第一关", "Boss", "UI"]]]);
    assert.equal((await json(`/api/projects/${id}/export.zip?status=all&tag=nope`)).status, 400);
    // untag; empty tag lists disappear
    const un = await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "untag", ids: [a.id, b.id], tags: ["ui", "boss"] } });
    const after = Object.fromEntries(un.body.project.assets.map((x: { id: string; tags?: string[] }) => [x.id, x.tags]));
    assert.deepEqual([after[a.id], after[b.id]], [["第一关"], undefined]);
    assert.equal((await json(`/api/projects/${id}/assets/${a.id}`, { method: "PATCH", body: { tags: "x" } })).status, 400);
  });

  it("renames an asset without touching its review", async () => {
    const asset = (await json(`/api/projects/${id}`)).body.assets[0];
    const r = await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: { name: "  火焰剑 v2  " } });
    assert.deepEqual([r.body.name, r.body.status], ["火焰剑 v2", asset.status]);
    assert.equal((await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: { name: "  " } })).status, 400);
    assert.equal((await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: {} })).status, 400);
  });

  it("sets UI 9-slice margins, carries them to new versions and into both exports", async () => {
    const run = await json(`/api/projects/${id}/run`, { method: "POST", body: { request: "面板", assetTypes: ["ui"], provider: "mock" } });
    await events(run.body.jobId);
    const assets = (await json(`/api/projects/${id}`)).body.assets;
    const ui = assets.find((a: { assetType: string }) => a.assetType === "ui");
    const other = assets.find((a: { assetType: string }) => a.assetType !== "ui");
    const { width, height } = await sharp(Buffer.from(await (await fetch(`${base}/api/projects/${id}/files/${ui.file}`)).arrayBuffer())).metadata();
    const margins = { left: 10, top: 8, right: 12, bottom: 6 };
    const patch = (assetId: string, nineSlice: unknown) => json(`/api/projects/${id}/assets/${assetId}`, { method: "PATCH", body: { nineSlice } });

    assert.deepEqual((await patch(ui.id, margins)).body.nineSlice, margins);
    assert.equal((await patch(other.id, margins)).status, 400, "only UI assets");
    assert.equal((await patch(ui.id, { ...margins, left: width! - 12 })).status, 400, "left + right must leave a centre");
    assert.equal((await patch(ui.id, { ...margins, top: 1.5 })).status, 400);
    assert.equal((await patch(ui.id, { left: 0, top: 0, right: 0, bottom: 0 })).status, 400);
    assert.equal((await patch("ast_missing", margins)).status, 404);
    const detected = (await json(`/api/projects/${id}/assets/${ui.id}/nine-slice`)).body;
    assert.ok("suggestion" in detected);
    assert.equal((await json(`/api/projects/${id}/assets/${other.id}/nine-slice`)).status, 400);

    // Post-processing keeps the layout, so the new version keeps the margins.
    const snapped = (await json(`/api/projects/${id}/assets/${ui.id}/snap-palette`, { method: "POST", body: {} })).body;
    assert.deepEqual(snapped.asset.nineSlice, margins);
    await json(`/api/projects/${id}/assets/${snapped.asset.id}`, { method: "DELETE" });

    const bundle = readZip(Buffer.from(await (await fetch(`${base}/api/projects/${id}/export.zip?ids=${ui.id}`)).arrayBuffer()));
    const entry = JSON.parse(bundle["manifest.json"].data.toString()).assets[0];
    assert.deepEqual(entry.nineSlice, margins);
    const tres = bundle[entry.files.godot].data.toString();
    assert.match(tres, /type="StyleBoxTexture"/);
    assert.match(tres, new RegExp(`path="res://assets/${entry.files.image}"`));
    assert.match(tres, /texture_margin_left = 10\.0\ntexture_margin_top = 8\.0\ntexture_margin_right = 12\.0\ntexture_margin_bottom = 6\.0/);

    // The atlas keeps the full image (no trim) and scales the margins with it.
    const max = 32;
    const atlas = readZip(Buffer.from(await (await fetch(`${base}/api/projects/${id}/export-atlas.zip?ids=${ui.id}&max=${max}`)).arrayBuffer()));
    const [frame] = Object.values(JSON.parse(atlas["atlas.json"].data.toString()).frames) as {
      frame: { w: number; h: number };
      scale9Borders: { x: number; y: number; w: number; h: number };
    }[];
    const k = Math.min(max / width!, max / height!);
    assert.deepEqual([frame.frame.w, frame.frame.h], [Math.round(width! * k), Math.round(height! * k)]);
    const b = frame.scale9Borders;
    assert.deepEqual([b.x, b.y], [Math.round(10 * k), Math.round(8 * k)]);
    assert.deepEqual([b.x + b.w + Math.round(12 * k), b.y + b.h + Math.round(6 * k)], [frame.frame.w, frame.frame.h]);

    const cleared = await patch(ui.id, null);
    assert.equal(cleared.body.nineSlice, undefined);
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

  it("exports Unity .meta files with stable GUIDs, sheet slicing and 9-slice borders", async () => {
    const assets = (await json(`/api/projects/${id}`)).body.assets;
    const sheet = assets.find((a: { assetType: string }) => a.assetType === "sprite_sheet");
    const ui = assets.find((a: { assetType: string }) => a.assetType === "ui");
    await json(`/api/projects/${id}/assets/${ui.id}`, { method: "PATCH", body: { nineSlice: { left: 10, top: 8, right: 12, bottom: 6 } } });
    const get = async (q: string) => readZip(Buffer.from(await (await fetch(`${base}/api/projects/${id}/export.zip?ids=${sheet.id},${ui.id}${q}`)).arrayBuffer()));
    const zip = await get("&unity=1&sizes=1");
    const images = Object.keys(zip).filter((n) => /\.(png|jpe?g|webp)$/.test(n) && !n.startsWith("_references/"));
    assert.ok(images.length >= 6, images.join());
    for (const n of images) assert.ok(zip[`${n}.meta`], `${n}.meta`);
    const manifest = JSON.parse(zip["manifest.json"].data.toString());
    const files = (assetId: string) => manifest.assets.find((a: { id: string }) => a.id === assetId).files;
    const sheetMeta = zip[`${files(sheet.id).image}.meta`].data.toString();
    assert.match(sheetMeta, /spriteMode: 2/);
    assert.equal(sheetMeta.match(/- serializedVersion: 2\n\s+name: /g)?.length, sheet.frames.length);
    assert.match(zip[`${files(ui.id).image}.meta`].data.toString(), /spriteBorder: \{x: 10, y: 6, z: 12, w: 8\}/);
    // The sheet's AnimationClip references exactly the sprites its .meta defines.
    const clip = zip[files(sheet.id).unity].data.toString();
    const sheetGuid = sheetMeta.match(/guid: (\w+)/)![1];
    const spriteIds = [...sheetMeta.matchAll(/internalID: (\d+)/g)].map((m) => m[1]);
    const keyRefs = [...clip.matchAll(/value: \{fileID: (\d+), guid: (\w+), type: 3\}/g)];
    assert.deepEqual(keyRefs.map((k) => k[1]), spriteIds);
    assert.ok(keyRefs.every((k) => k[2] === sheetGuid));
    assert.ok(zip[`${files(sheet.id).unity}.meta`]);
    // Same GUIDs on the next export, even after a rename.
    await json(`/api/projects/${id}/assets/${ui.id}`, { method: "PATCH", body: { name: "面板改名" } });
    const again = await get("&unity=1");
    const guid = (z: typeof zip, n: string) => z[n].data.toString().match(/guid: (\w+)/)![1];
    const renamed = JSON.parse(again["manifest.json"].data.toString()).assets.find((a: { id: string }) => a.id === ui.id).files.image;
    assert.equal(guid(again, `${renamed}.meta`), guid(zip, `${files(ui.id).image}.meta`));
    assert.ok(!Object.keys(await get("")).some((n) => n.endsWith(".meta")), "no .meta without ?unity");
    await json(`/api/projects/${id}/assets/${ui.id}`, { method: "PATCH", body: { nineSlice: null } });
  });

  it("outlines an asset as a new version and validates the options", async () => {
    const assets = (await json(`/api/projects/${id}`)).body.assets;
    const sheet = assets.find((a: { assetType: string }) => a.assetType === "sprite_sheet");
    const tile = assets.find((a: { assetType: string }) => a.assetType === "tile");
    const post = (assetId: string, body: unknown) => json(`/api/projects/${id}/assets/${assetId}/outline`, { method: "POST", body });
    const r = await post(sheet.id, { width: 2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.parentId, r.body.frames.length, r.body.status], [sheet.id, sheet.frames.length, "pending_review"]);
    assert.match(r.body.notes, /2px 描边/);
    assert.equal((await post(tile.id, {})).status, 400);
    assert.equal((await post(sheet.id, { width: 0 })).status, 400);
    assert.equal((await post(sheet.id, { width: 2, color: "blue" })).status, 400);
    assert.equal((await post("ast_missing", {})).status, 404);
    await json(`/api/projects/${id}/assets/${r.body.id}`, { method: "DELETE" });
  });

  it("lists main colours and makes colour-swap variants as sibling assets", async () => {
    const sheet = (await json(`/api/projects/${id}`)).body.assets.find((a: { assetType: string }) => a.assetType === "sprite_sheet");
    const { colors } = (await json(`/api/projects/${id}/assets/${sheet.id}/colors`)).body;
    assert.ok(colors.length >= 1 && colors.every((c: { hex: string; share: number }) => /^#[0-9a-f]{6}$/.test(c.hex) && c.share > 0));
    const post = (body: unknown) => json(`/api/projects/${id}/assets/${sheet.id}/recolor`, { method: "POST", body });
    const r = await post({ swaps: [{ from: colors[0].hex, to: "#d84848" }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.variantOf, r.body.parentId, r.body.status, r.body.frames.length], [sheet.id, undefined, "pending_review", sheet.frames.length]);
    assert.equal(r.body.name, `${sheet.name}（变体）`);
    assert.equal((await post({ swaps: [{ from: colors[0].hex, to: "#d84848" }], name: " 精英 " })).body.name, "精英");
    assert.equal((await post({ swaps: [] })).status, 400);
    assert.equal((await post({ swaps: [{ from: "red", to: "#d84848" }] })).status, 400);
    assert.equal((await post({ swaps: [{ from: colors[0].hex, to: "#d84848" }], threshold: 99 })).status, 400);
    assert.equal((await json(`/api/projects/${id}/assets/ast_missing/colors`)).status, 404);
    const variants = (await json(`/api/projects/${id}`)).body.assets.filter((a: { variantOf?: string }) => a.variantOf === sheet.id);
    assert.equal(variants.length, 2);
    await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "purge", ids: variants.map((v: { id: string }) => v.id) } });
  });

  it("exports a Godot TileSet built from the tiles", async () => {
    const tiles = (await json(`/api/projects/${id}`)).body.assets.filter((a: { assetType: string }) => a.assetType === "tile");
    assert.ok(tiles.length >= 1);
    const zip = readZip(Buffer.from(await (await fetch(`${base}/api/projects/${id}/export.zip?status=all&tile=16`)).arrayBuffer()));
    const { tileset } = JSON.parse(zip["manifest.json"].data.toString());
    assert.equal(tileset.tileSize, 16);
    assert.deepEqual(tileset.tiles.map((t: { id: string }) => t.id), tiles.map((t: { id: string }) => t.id));
    const meta = await sharp(zip["tile/tileset.png"].data).metadata();
    assert.deepEqual([meta.width, meta.height], [Math.min(8, tiles.length) * 16, Math.ceil(tiles.length / 8) * 16]);
    const tres = zip["tile/tileset.tres"].data.toString();
    assert.match(tres, /path="res:\/\/assets\/tile\/tileset\.png"/);
    assert.equal(tres.match(/^\d+:\d+\/0 = 0$/gm)?.length, tiles.length);
    assert.equal((await json(`/api/projects/${id}/export.zip?status=all&tile=3`)).status, 400);
    const other = (await json(`/api/projects/${id}`)).body.assets.find((a: { assetType: string }) => a.assetType !== "tile");
    const withoutTiles = readZip(Buffer.from(await (await fetch(`${base}/api/projects/${id}/export.zip?ids=${other.id}`)).arrayBuffer()));
    assert.equal(JSON.parse(withoutTiles["manifest.json"].data.toString()).tileset, null, "no TileSet without tiles");
  });

  it("ranks current assets by drift from the style", async () => {
    const r = await json(`/api/projects/${id}/consistency`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const assets = (await json(`/api/projects/${id}`)).body.assets as { id: string; parentId?: string; variantOf?: string }[];
    const superseded = new Set(assets.map((a) => a.parentId).filter(Boolean));
    const ids = r.body.items.map((i: { id: string }) => i.id);
    assert.equal(ids.length, assets.filter((a) => !superseded.has(a.id) && !a.variantOf).length);
    assert.ok(!ids.some((i: string) => superseded.has(i)), "superseded versions are left out");
    // A colour variant is off-palette on purpose: it doesn't show up as drift.
    const sheet = assets.find((a) => !superseded.has(a.id) && !a.variantOf && ids.includes(a.id))!;
    const variant = (await json(`/api/projects/${id}/assets/${sheet.id}/recolor`, { method: "POST", body: { swaps: [{ from: "#000000", to: "#ff00ff" }], threshold: 60 } })).body;
    assert.ok(!(await json(`/api/projects/${id}/consistency`)).body.items.some((i: { id: string }) => i.id === variant.id));
    await json(`/api/projects/${id}/assets/batch`, { method: "POST", body: { action: "purge", ids: [variant.id] } });
    const drifts = r.body.items.map((i: { drift: number }) => i.drift);
    assert.deepEqual(drifts, [...drifts].sort((a, b) => b - a));
    assert.ok(r.body.items.every((i: { coverage: number; reasons: unknown[] }) => i.coverage >= 0 && i.coverage <= 1 && Array.isArray(i.reasons)));
    const bare = (await json("/api/projects", { method: "POST", body: { name: "无色板" } })).body;
    assert.equal((await json(`/api/projects/${bare.id}/consistency`)).status, 400);
  });

  it("starts an action-set run for a character and validates the request", async () => {
    assert.ok("idle" in (await json("/api/config")).body.actionPresets);
    const made = await json(`/api/projects/${id}/run`, { method: "POST", body: { request: "主角", assetTypes: ["character"], provider: "mock" } });
    await events(made.body.jobId);
    const assets = (await json(`/api/projects/${id}`)).body.assets;
    const hero = assets.findLast((a: { assetType: string }) => a.assetType === "character");
    const other = assets.find((a: { assetType: string }) => a.assetType === "tile");
    const post = (assetId: string, body: unknown) => json(`/api/projects/${id}/assets/${assetId}/action-set`, { method: "POST", body });
    assert.equal((await post(other.id, { actions: ["idle"] })).status, 400, "only characters and enemies");
    assert.equal((await post(hero.id, { actions: [] })).status, 400);
    assert.equal((await post(hero.id, { actions: ["dance"] })).status, 400, "unknown actions are dropped");
    assert.equal((await post("ast_missing", { actions: ["idle"] })).status, 404);
    const before = assets.filter((a: { assetType: string }) => a.assetType === "sprite_sheet").length;
    const r = await post(hero.id, { actions: ["idle", "walk", "idle"], provider: "mock" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const evs = await events(r.body.jobId);
    assert.ok(evs.some((e: { type: string }) => e.type === "done"), JSON.stringify(evs.at(-1)));
    const after = (await json(`/api/projects/${id}`)).body.assets.filter((a: { assetType: string }) => a.assetType === "sprite_sheet").length;
    assert.ok(after > before, "the run made sprite sheets");
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
    // Without fps the current rate is kept; bad rates are refused.
    const kept = await json(`/api/projects/${id}/assets/${sheet.id}/slice`, { method: "POST", body: { frames: 6 } });
    assert.equal(kept.body.fps, 12);
    for (const fps of [0, 31, 1.5, "fast"]) {
      assert.equal((await json(`/api/projects/${id}/assets/${sheet.id}/slice`, { method: "POST", body: { frames: 6, fps } })).status, 400, String(fps));
    }
    // Exports use the saved rate.
    const bundle = readZip(Buffer.from(await (await fetch(`${base}/api/projects/${id}/export.zip?ids=${sheet.id}&unity=1`)).arrayBuffer()));
    const godot = Object.entries(bundle).find(([n]) => n.endsWith(".tres"))![1].data.toString();
    assert.match(godot, /"speed": 12\.0/);
    assert.match(Object.entries(bundle).find(([n]) => n.endsWith(".anim"))![1].data.toString(), /m_SampleRate: 12/);
    const tile = assets.findLast((a: { assetType: string }) => a.assetType === "tile");
    const tiled = await fetch(`${base}/api/projects/${id}/assets/${tile.id}/tiled.png?n=2`);
    const { default: sharp } = await import("sharp");
    const meta = await sharp(Buffer.from(await tiled.arrayBuffer())).metadata();
    assert.deepEqual([meta.width, meta.height], [1024, 1024]);
    assert.equal((await json(`/api/projects/${id}/assets/${tile.id}/tiled.png?n=9`)).status, 400);
  });

  it("redraws several assets in one demo run and limits the count", async () => {
    const ids = (await json(`/api/projects/${id}`)).body.assets.slice(0, 2).map((a: { id: string }) => a.id);
    const r = await json(`/api/projects/${id}/run`, { method: "POST", body: { redraws: ids.map((assetId: string) => ({ assetId, feedback: "更亮" })), provider: "mock" } });
    await events(r.body.jobId);
    const made = (await json(`/api/projects/${id}`)).body.assets.slice(-2).map((a: { parentId: string }) => a.parentId);
    assert.deepEqual(made.sort(), [...ids].sort());
    const tooMany = Array.from({ length: 11 }, () => ({ assetId: ids[0], feedback: "x" }));
    assert.equal((await json(`/api/projects/${id}/run`, { method: "POST", body: { redraws: tooMany } })).status, 400);
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
      assert.equal((await json(`/api/projects/${id}`, { method: "DELETE" })).status, 409, "no deleting a project mid-run");
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
