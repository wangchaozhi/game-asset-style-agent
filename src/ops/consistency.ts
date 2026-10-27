import { type DriftReport, rankDrift } from "../domain/consistency.js";
import { analyzePalette } from "../image/palette.js";
import { readProjectFile } from "../store/index.js";
import type { Project } from "../store/types.js";

export interface ConsistencyReport {
  medianCoverage: number;
  medianDeltaE: number;
  items: (DriftReport & { coverage: number; meanDeltaE: number })[];
}

/**
 * Which assets drift furthest from the project's style: every current asset (not superseded by a newer
 * version, not a colour variant, not in the trash) is measured against the current palette and ranked
 * against the project median. Null when the project has no palette yet.
 */
export async function measureConsistency(project: Project): Promise<ConsistencyReport | null> {
  const hexes = project.styleGuide?.palette.map((p) => p.hex) ?? [];
  if (!hexes.length) return null;
  const superseded = new Set(project.assets.map((a) => a.parentId).filter(Boolean));
  // Colour-swap variants are off-palette on purpose, so they are left out.
  const current = project.assets.filter((a) => !superseded.has(a.id) && !a.variantOf).slice(-300);
  const measured = await Promise.all(
    current.map(async (a) => {
      const r = await analyzePalette(await readProjectFile(project.id, a.file), hexes);
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
