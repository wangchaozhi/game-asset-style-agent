import { SIZE_PRESETS, isPixelArt, parseSize, resizeAsset } from "../image/sizes.js";
import { readProjectFile } from "../store/index.js";
import type { Project } from "../store/types.js";
import { type ZipEntry, createZip } from "./zip.js";

export interface ExportOptions {
  /** include every asset, not only approved ones */
  all?: boolean;
  /** add each asset's common game sizes */
  sizes?: boolean;
}

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

/**
 * Build the asset bundle ZIP: one folder per asset type, plus references,
 * style-guide.json and manifest.json. Returns null when there is nothing to export.
 */
export async function buildExport(project: Project, opts: ExportOptions = {}): Promise<{ filename: string; zip: Buffer } | null> {
  const assets = project.assets.filter((a) => opts.all || a.status === "approved");
  if (!assets.length) return null;

  const entries: ZipEntry[] = [];
  const unique = uniqueNamer();
  const manifest = [];
  const pixel = isPixelArt(project.styleGuide);
  for (const a of assets) {
    const base = unique(`${a.assetType}/${safeName(a.name)}`);
    const ext = a.file.split(".").pop();
    const original = await readProjectFile(project.id, a.file);
    const files: Record<string, string | string[]> = { image: `${base}.${ext}` };
    entries.push({ name: `${base}.${ext}`, data: original });
    if (opts.sizes) {
      const sized: string[] = (files.sizes = []);
      for (const spec of SIZE_PRESETS[a.assetType] ?? []) {
        const name = `${base}@${spec}.png`;
        sized.push(name);
        entries.push({
          name,
          data: await resizeAsset(original, { ...parseSize(spec)!, assetType: a.assetType, pixel, frames: a.frames?.length }),
        });
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
      }
    }
    manifest.push({
      id: a.id, name: a.name, type: a.assetType, status: a.status, score: a.score ?? null,
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
