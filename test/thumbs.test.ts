import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import { solidPng, useTempDataDir } from "./helpers.js";

const dataDir = useTempDataDir();
const store = await import("../src/store/index.js");
const { getThumb, thumbPath, thumbSource } = await import("../src/image/thumbs.js");

describe("thumbnails", () => {
  it("makes a WebP no wider than requested and caches it", async () => {
    const p = await store.createProject("t");
    const dir = path.join(dataDir, "projects", p.id);
    await store.writeProjectFile(p.id, "assets/ast_a.png", await solidPng(1024, 512, "#336699"));
    const t = await getThumb(dir, "assets/ast_a.png", 320, false);
    const m = await sharp(t).metadata();
    assert.deepEqual([m.format, m.width, m.height], ["webp", 320, 160]);
    const cached = thumbPath(dir, "assets/ast_a.png", 320, false);
    assert.ok(fs.existsSync(cached));
    assert.equal(path.basename(cached), "ast_a.png.320.webp");
    assert.equal(thumbSource(path.basename(cached)), "ast_a.png");
    // served from cache: same bytes even if we tamper with the cached copy's content
    fs.writeFileSync(cached, Buffer.from("cached"));
    assert.equal((await getThumb(dir, "assets/ast_a.png", 320, false)).toString(), "cached");
  });

  it("regenerates when the source is newer", async () => {
    const p = await store.createProject("t2");
    const dir = path.join(dataDir, "projects", p.id);
    await store.writeProjectFile(p.id, "assets/ast_b.png", await solidPng(64, 64, "#ff0000"));
    await getThumb(dir, "assets/ast_b.png", 160, false);
    const cached = thumbPath(dir, "assets/ast_b.png", 160, false);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(cached, old, old);
    await store.writeProjectFile(p.id, "assets/ast_b.png", await solidPng(64, 64, "#00ff00"));
    const { data } = await sharp(await getThumb(dir, "assets/ast_b.png", 160, false)).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[1] > 200 && data[0] < 50, "green now");
  });

  it("keeps GIFs animated and scales pixel art up crisply", async () => {
    const p = await store.createProject("t3");
    const dir = path.join(dataDir, "projects", p.id);
    const frames = await Promise.all(["#ff0000", "#00ff00", "#0000ff"].map((c) => solidPng(32, 32, c)));
    await store.writeProjectFile(p.id, "assets/ast_c.gif", await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer());
    const m = await sharp(await getThumb(dir, "assets/ast_c.gif", 160, false), { animated: true }).metadata();
    assert.equal(m.pages, 3);
    await store.writeProjectFile(p.id, "assets/ast_d.png", await solidPng(16, 16, "#123456"));
    const px = await sharp(await getThumb(dir, "assets/ast_d.png", 160, true)).metadata();
    assert.equal(px.width, 160, "pixel art may be enlarged");
    const smooth = await sharp(await getThumb(dir, "assets/ast_d.png", 160, false)).metadata();
    assert.equal(smooth.width, 16, "other art is never enlarged");
  });

  it("is removed with its asset and by the orphan sweep", async () => {
    const p = await store.createProject("t4");
    const dir = path.join(dataDir, "projects", p.id);
    await store.writeProjectFile(p.id, "assets/ast_e.png", await solidPng(64, 64, "#000000"));
    await store.writeProjectFile(p.id, "assets/ast_f.png", await solidPng(64, 64, "#000000"));
    await getThumb(dir, "assets/ast_e.png", 160, false);
    await getThumb(dir, "assets/ast_f.png", 160, false);
    await store.removeAssetFiles(p.id, ["ast_e"]);
    assert.deepEqual(fs.readdirSync(path.join(dir, "thumbs/assets")), ["ast_f.png.160.webp"]);
    fs.rmSync(path.join(dir, "assets/ast_f.png"));
    const project = await store.loadProject(p.id);
    await store.removeOrphanFiles(project);
    assert.deepEqual(fs.readdirSync(path.join(dir, "thumbs/assets")), []);
  });
});
