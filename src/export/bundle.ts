import { SIZE_PRESETS, isPixelArt, parseSize, resizeAsset } from "../image/sizes.js";
import { hasTag } from "../domain/tags.js";
import { fitNineSlice, scaleNineSlice } from "../domain/nineSlice.js";
import { imageSize } from "../image/io.js";
import { readProjectFile } from "../store/index.js";
import type { Project } from "../store/types.js";
import { type AtlasInput, buildAtlas, prepareSprite, scaleSprite } from "./atlas.js";
import { spriteFramesTres, styleBoxTextureTres } from "./godot.js";
import { type UnitySpriteMeta, spriteMeta } from "./unity.js";
import { type ZipEntry, createZip } from "./zip.js";

export interface ExportOptions {
  /** include every asset, not only approved ones */
  all?: boolean;
  /** export exactly these assets (any status); overrides `all` */
  ids?: string[];
  /** only assets carrying this tag */
  tag?: string;
  /** add each asset's common game sizes */
  sizes?: boolean;
  /** folder under res:// where the bundle is unzipped in a Godot project (for .tres paths) */
  godotRoot?: string;
  /** add a Unity TextureImporter .meta next to every image */
  unity?: boolean;
}

/** Types drawn standing on the ground: their sprites pivot at the bottom centre. */
const STANDING_TYPES = new Set(["character", "enemy", "sprite_sheet", "prop"]);

/** Strip characters that are unsafe in archive paths. */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "asset";

/** Returns a de-duplicating namer: "a", "a_2", "a_3"… */
export function uniqueNamer() {
  const used = new Set<string>();
  return (base: string) => {
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    return name;
  };
}

/** Explicit ids win; otherwise approved only, or everything with `all`; then narrowed to `tag`. */
export function selectAssets(project: Project, opts: { all?: boolean; ids?: string[]; tag?: string }) {
  const ids = opts.ids?.length ? new Set(opts.ids) : null;
  return project.assets.filter(
    (a) => (ids ? ids.has(a.id) : opts.all || a.status === "approved") && (!opts.tag || hasTag(a.tags, opts.tag)),
  );
}

/**
 * Build the asset bundle ZIP: one folder per asset type, plus references,
 * style-guide.json and manifest.json. Returns null when there is nothing to export.
 */
export async function buildExport(project: Project, opts: ExportOptions = {}): Promise<{ filename: string; zip: Buffer } | null> {
  const assets = selectAssets(project, opts);
  if (!assets.length) return null;

  const entries: ZipEntry[] = [];
  const unique = uniqueNamer();
  const manifest = [];
  const pixel = isPixelArt(project.styleGuide);
  const root = (opts.godotRoot ?? "assets").replace(/^res:\/\//, "").replace(/^\/+|\/+$/g, "");
  const resPath = (f: string) => `res://${root ? `${root}/` : ""}${f}`;
  for (const a of assets) {
    const base = unique(`${a.assetType}/${safeName(a.name)}`);
    const ext = a.file.split(".").pop();
    const original = await readProjectFile(project.id, a.file);
    const files: Record<string, string | string[]> = { image: `${base}.${ext}` };
    entries.push({ name: `${base}.${ext}`, data: original });
    // Re-checked against the real image: stored margins may come from an imported backup.
    const size = a.nineSlice || opts.unity ? await imageSize(original) : null;
    const nineSlice = size && fitNineSlice(a.nineSlice, size.width, size.height);
    /** Unity .meta beside an image; the GUID follows the asset id and role, not the (renamable) file name. */
    const meta = (name: string, role: string, o: Omit<UnitySpriteMeta, "seed" | "pixel"> = {}) => {
      if (!opts.unity) return;
      const repeat = a.assetType === "tile";
      entries.push({ name: `${name}.meta`, data: Buffer.from(spriteMeta({ seed: `${project.id}/${a.id}/${role}`, pixel, repeat, ...o })) });
    };
    const standing = STANDING_TYPES.has(a.assetType);
    const sheet = (w: number, h: number) =>
      a.frames?.length ? { count: a.frames.length, width: Math.floor(w / a.frames.length), height: h, name: safeName(a.name) } : undefined;
    meta(`${base}.${ext}`, "image", { nineSlice, bottomPivot: standing, frames: size ? sheet(size.width, size.height) : undefined });
    if (nineSlice) {
      files.godot = `${base}.tres`;
      entries.push({ name: `${base}.tres`, data: Buffer.from(styleBoxTextureTres(resPath(`${base}.${ext}`), nineSlice)) });
    }
    if (opts.sizes) {
      const sized: string[] = (files.sizes = []);
      for (const spec of SIZE_PRESETS[a.assetType] ?? []) {
        const name = `${base}@${spec}.png`;
        sized.push(name);
        const data = await resizeAsset(original, { ...parseSize(spec)!, assetType: a.assetType, pixel, frames: a.frames?.length });
        entries.push({ name, data });
        if (opts.unity && size) {
          const out = await imageSize(data);
          meta(name, `size:${spec}`, {
            nineSlice: nineSlice && scaleNineSlice(nineSlice, size, out),
            bottomPivot: standing,
            frames: sheet(out.width, out.height),
          });
        }
      }
    }
    if (a.gif) {
      files.gif = `${base}.gif`;
      entries.push({ name: `${base}.gif`, data: await readProjectFile(project.id, a.gif) });
    }
    if (a.frames?.length) {
      const frames: string[] = (files.frames = []);
      for (const [i, f] of a.frames.entries()) {
        const name = `${base}_frames/${String(i).padStart(2, "0")}.png`;
        frames.push(name);
        entries.push({ name, data: await readProjectFile(project.id, f) });
        meta(name, `frame:${i}`, { bottomPivot: true });
      }
      const tres = spriteFramesTres(frames.map(resPath), { name: "default", fps: a.fps ?? 8 });
      files.godot = `${base}.tres`;
      entries.push({ name: `${base}.tres`, data: Buffer.from(tres) });
    }
    manifest.push({
      id: a.id, name: a.name, type: a.assetType, status: a.status, score: a.score ?? null, tags: a.tags ?? [], nineSlice: nineSlice ?? null,
      notes: a.notes ?? null, prompt: a.prompt, provider: a.provider, createdAt: a.createdAt, fps: a.fps ?? null, files,
    });
  }
  for (const [i, r] of project.refs.entries()) {
    entries.push({ name: `_references/ref_${i + 1}.png`, data: await readProjectFile(project.id, r.file) });
  }
  const json = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2));
  entries.push({ name: "style-guide.json", data: json(project.styleGuide) });
  entries.push({
    name: "manifest.json",
    data: json({ project: project.name, exportedAt: new Date().toISOString(), count: manifest.length, assets: manifest }),
  });
  return { filename: `${safeName(project.name)}_assets.zip`, zip: createZip(entries) };
}

export interface AtlasExportOptions {
  all?: boolean;
  ids?: string[];
  tag?: string;
  /** longest side of each sprite in the atlas, px */
  maxSprite?: number;
  /** longest side of an atlas page, px */
  maxSize?: number;
}

const ATLAS_README = `Texture atlas exported by Game Asset Agent

atlas*.png + atlas*.json   TexturePacker "JSON Hash" format (Phaser, PixiJS, Cocos, …)
animations.json            Phaser 3 animations for sprite sheets (this.anims.fromJSON)

Phaser 3:
  preload() { this.load.atlas("atlas", "atlas.png", "atlas.json"); this.load.json("anims", "animations.json"); }
  create()  { this.anims.fromJSON(this.cache.json.get("anims")); this.add.sprite(100, 100, "atlas", "item_icon/sword"); }
UI frames with 9-slice margins carry "scale9Borders" (Phaser 3.60+ reads them):
  this.add.nineslice(200, 100, "atlas", "ui/panel", 320, 120);
With several pages, load each as atlas_0, atlas_1, … (texture keys match the page file names).
`;

/**
 * Pack approved sprites (backgrounds excluded) into atlas pages. Sprite sheets contribute one frame per
 * animation frame and an entry in animations.json. Returns null when there is nothing to pack.
 */
export async function buildAtlasExport(project: Project, opts: AtlasExportOptions = {}): Promise<{ filename: string; zip: Buffer } | null> {
  const assets = selectAssets(project, opts).filter((a) => a.assetType !== "background");
  if (!assets.length) return null;
  const pixel = isPixelArt(project.styleGuide);
  const maxSprite = opts.maxSprite ?? 256;
  const unique = uniqueNamer();
  const images: AtlasInput[] = [];
  const animations: { key: string; frames: string[]; fps: number }[] = [];
  for (const a of assets) {
    const key = unique(`${a.assetType}/${safeName(a.name)}`);
    if (a.frames?.length) {
      const frames: string[] = [];
      for (const [i, f] of a.frames.entries()) {
        const name = `${key}/${String(i).padStart(2, "0")}`;
        frames.push(name);
        // Frames keep their full cell (no trim) so the animation doesn't jitter.
        images.push({ name, data: await scaleSprite(await readProjectFile(project.id, f), maxSprite, pixel) });
      }
      animations.push({ key, frames, fps: a.fps ?? 8 });
    } else {
      const data = await readProjectFile(project.id, a.file);
      const size = a.nineSlice ? await imageSize(data) : null;
      const slice = size && fitNineSlice(a.nineSlice, size.width, size.height);
      if (slice && size) {
        // No trim: the margins are measured from the image edges. Scale them with the sprite.
        const scaled = await scaleSprite(data, maxSprite, pixel);
        const m = scaleNineSlice(slice, size, await imageSize(scaled));
        images.push({ name: key, data: scaled, nineSlice: m });
      } else {
        images.push({ name: key, data: await prepareSprite(data, maxSprite, pixel) });
      }
    }
  }
  const atlas = await buildAtlas(images, { maxSize: opts.maxSize ?? 2048 });
  const pageOf = new Map<string, string>();
  for (const p of atlas.pages) for (const f of Object.keys((p.json as { frames: object }).frames)) pageOf.set(f, p.image.replace(/\.png$/, ""));

  const entries: ZipEntry[] = [];
  for (const p of atlas.pages) {
    entries.push({ name: p.image, data: p.png });
    entries.push({ name: p.image.replace(/\.png$/, ".json"), data: Buffer.from(JSON.stringify(p.json, null, 2)) });
  }
  entries.push({
    name: "animations.json",
    data: Buffer.from(
      JSON.stringify(
        {
          anims: animations.map((an) => ({
            key: an.key,
            type: "frame",
            frames: an.frames.map((frame) => ({ key: pageOf.get(frame), frame })),
            frameRate: an.fps,
            repeat: -1,
          })),
        },
        null,
        2,
      ),
    ),
  });
  entries.push({ name: "README.txt", data: Buffer.from(ATLAS_README) });
  return { filename: `${safeName(project.name)}_atlas.zip`, zip: createZip(entries) };
}
