import fs from "node:fs/promises";
import path from "node:path";
import { dHash, hammingDistance } from "../image/phash.js";
import { projectDir, readProjectFile } from "../store/index.js";
import type { Asset, Project } from "../store/types.js";

/** Up to this many differing bits counts as "looks the same". */
export const SIMILAR_MAX_DISTANCE = 10;

/** Hashes by project, file, size and mtime; oldest dropped past CACHE_MAX. */
const cache = new Map<string, string>();
const CACHE_MAX = 5000;

async function hashOf(projectId: string, file: string): Promise<string> {
  const st = await fs.stat(path.join(projectDir(projectId), file));
  const key = `${projectId}/${file}|${st.size}|${st.mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const h = await dHash(await readProjectFile(projectId, file));
  cache.set(key, h);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return h;
}

/** The picture to compare: a sprite sheet's first frame (sheets differ in width), else the file. */
const pictureOf = (a: Asset) => a.frames?.[0] ?? a.file;

/** The asset's version family: up to its root through parentId / variantOf, then everything descending from it. */
export function lineageOf(assets: Asset[], asset: Asset): Set<string> {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const up = (a: Asset) => byId.get(a.parentId ?? a.variantOf ?? "");
  let root = asset;
  const seen = new Set([asset.id]);
  for (let p = up(root); p && !seen.has(p.id); p = up(p)) {
    seen.add(p.id);
    root = p;
  }
  const family = new Set<string>();
  const stack = [root.id];
  while (stack.length) {
    const id = stack.pop()!;
    family.add(id);
    for (const a of assets) if ((a.parentId === id || a.variantOf === id) && !family.has(a.id)) stack.push(a.id);
  }
  return family;
}

/**
 * Assets in the library that look like `asset`, closest first: within SIMILAR_MAX_DISTANCE bits,
 * excluding itself. `related` marks its own versions and colour variants, which are expected to look alike.
 */
export async function similarAssets(project: Project, asset: Asset, max = 12) {
  const own = await hashOf(project.id, pictureOf(asset));
  const lineage = lineageOf(project.assets, asset);
  const out: { id: string; distance: number; related: boolean }[] = [];
  for (const a of project.assets) {
    if (a.id === asset.id) continue;
    const d = hammingDistance(own, await hashOf(project.id, pictureOf(a)));
    if (d <= SIMILAR_MAX_DISTANCE) out.push({ id: a.id, distance: d, related: lineage.has(a.id) });
  }
  return out.sort((x, y) => x.distance - y.distance).slice(0, max);
}
