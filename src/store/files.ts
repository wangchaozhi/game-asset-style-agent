import fs from "node:fs/promises";
import path from "node:path";
import { thumbSource } from "../image/thumbs.js";
import type { Project } from "./types.js";
import { projectDir } from "./fs.js";

// Every file an asset owns lives in assets/ and starts with its id: <id>.png, <id>_orig.png,
// <id>_cut….png, <id>_f0.png, <id>.gif. References live in refs/<refId>.png.
const ownedBy = (file: string, id: string) => file.startsWith(`${id}.`) || file.startsWith(`${id}_`);

async function listDir(dir: string): Promise<string[]> {
  return fs.readdir(dir).catch(() => []);
}

async function removeFiles(dir: string, names: string[]): Promise<{ removed: number; bytes: number }> {
  let removed = 0;
  let bytes = 0;
  for (const n of names) {
    const file = path.join(dir, n);
    const size = await fs.stat(file).then((s) => s.size, () => 0);
    await fs.rm(file, { force: true });
    removed++;
    bytes += size;
  }
  return { removed, bytes };
}

/** Remove files in `sub` (and their cached thumbnails) that belong to any of `ids`. */
async function removeOwned(projectId: string, sub: "assets" | "refs", ids: string[]) {
  const dir = path.join(projectDir(projectId), sub);
  const thumbs = path.join(projectDir(projectId), "thumbs", sub);
  const owned = (f: string) => ids.some((id) => ownedBy(f, id));
  const a = await removeFiles(dir, (await listDir(dir)).filter(owned));
  const t = await removeFiles(thumbs, (await listDir(thumbs)).filter(owned));
  return { removed: a.removed + t.removed, bytes: a.bytes + t.bytes };
}

/** Delete every file belonging to these assets. */
export const removeAssetFiles = (projectId: string, assetIds: string[]) => removeOwned(projectId, "assets", assetIds);

/** Delete a reference image's file. */
export const removeRefFile = (projectId: string, refId: string) => removeOwned(projectId, "refs", [refId]);

/**
 * Remove files no asset or reference owns any more (left by deletes before this cleanup existed,
 * or by a crash mid-generation). Only safe while no job is writing to the project.
 */
export async function removeOrphanFiles(project: Project) {
  const assetsDir = path.join(projectDir(project.id), "assets");
  const refsDir = path.join(projectDir(project.id), "refs");
  const assetIds = project.assets.map((a) => a.id);
  const refFiles = new Set(project.refs.map((r) => path.basename(r.file)));
  const a = await removeFiles(assetsDir, (await listDir(assetsDir)).filter((f) => !assetIds.some((id) => ownedBy(f, id))));
  const r = await removeFiles(refsDir, (await listDir(refsDir)).filter((f) => !refFiles.has(f)));
  // Thumbnails whose source file is gone.
  let t = { removed: 0, bytes: 0 };
  for (const sub of ["assets", "refs"]) {
    const dir = path.join(projectDir(project.id), "thumbs", sub);
    const sources = new Set(await listDir(path.join(projectDir(project.id), sub)));
    const r2 = await removeFiles(dir, (await listDir(dir)).filter((f) => !sources.has(thumbSource(f))));
    t = { removed: t.removed + r2.removed, bytes: t.bytes + r2.bytes };
  }
  return { removed: a.removed + r.removed + t.removed, bytes: a.bytes + r.bytes + t.bytes };
}

/** Total size of a project's folder in bytes. */
export async function projectDiskUsage(projectId: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else total += await fs.stat(p).then((s) => s.size, () => 0);
    }
  };
  await walk(projectDir(projectId));
  return total;
}
