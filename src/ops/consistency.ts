import fs from "node:fs/promises";
import path from "node:path";
import { type DriftReport, rankDrift } from "../domain/consistency.js";
import { hasTag } from "../domain/tags.js";
import { type PaletteReport, analyzePalette } from "../image/palette.js";
import { projectDir, readProjectFile } from "../store/index.js";
import type { Project } from "../store/types.js";

export interface ConsistencyReport {
  medianCoverage: number;
  medianDeltaE: number;
  items: (DriftReport & { coverage: number; meanDeltaE: number })[];
}

/** Palette measurements by project, file, file size + mtime and palette; oldest dropped past CACHE_MAX. */
const cache = new Map<string, PaletteReport>();
const CACHE_MAX = 5000;
const stats = { hits: 0, misses: 0 };

/** Cache counters, for tests. */
export const consistencyCacheStats = () => ({ ...stats, size: cache.size });

/** analyzePalette, remembered until the file or the palette changes. */
async function measure(projectId: string, file: string, hexes: string[]): Promise<PaletteReport> {
  const st = await fs.stat(path.join(projectDir(projectId), file));
  const key = `${projectId}/${file}|${st.size}|${st.mtimeMs}|${hexes.join(",").toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) {
    stats.hits++;
    return hit;
  }
  stats.misses++;
  const r = await analyzePalette(await readProjectFile(projectId, file), hexes);
  cache.set(key, r);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return r;
}

/**
 * Which assets drift furthest from the project's style: every current asset (not superseded by a newer
 * version, not a colour variant, not in the trash) is measured against the current palette and ranked
 * against the project median (or, with `tag`, only that tag's assets against their own median).
 * Null when the project has no palette yet.
 */
export async function measureConsistency(project: Project, opts: { tag?: string } = {}): Promise<ConsistencyReport | null> {
  const hexes = project.styleGuide?.palette.map((p) => p.hex) ?? [];
  if (!hexes.length) return null;
  const superseded = new Set(project.assets.map((a) => a.parentId).filter(Boolean));
  // Colour-swap variants are off-palette on purpose, so they are left out.
  // With a tag, the medians come from that group alone: does this character / level hang together?
  const current = project.assets
    .filter((a) => !superseded.has(a.id) && !a.variantOf && (!opts.tag || hasTag(a.tags, opts.tag)))
    .slice(-300);
  const measured = await Promise.all(
    current.map(async (a) => {
      const r = await measure(project.id, a.file, hexes);
      return { id: a.id, coverage: r.coverage, meanDeltaE: r.meanDeltaE, score: a.reviewer === "agent" ? a.score : undefined, offPalette: r.offPalette };
    }),
  );
  const ranked = rankDrift(measured);
  const byId = new Map(measured.map((m) => [m.id, m]));
  return {
    medianCoverage: ranked.medianCoverage,
    medianDeltaE: ranked.medianDeltaE,
    items: ranked.items.map((r) => ({ ...r, coverage: byId.get(r.id)!.coverage, meanDeltaE: byId.get(r.id)!.meanDeltaE })),
  };
}
