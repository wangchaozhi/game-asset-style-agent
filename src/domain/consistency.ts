/** One asset's measurements against the current style guide. */
export interface ConsistencyInput {
  id: string;
  coverage: number;
  meanDeltaE: number;
  /** the agent's 1-10 consistency score, if it reviewed the asset */
  score?: number;
  /** main off-palette colours */
  offPalette: { hex: string; share: number }[];
}

export interface DriftReport {
  id: string;
  /** 0 = in line with the project; higher = further off */
  drift: number;
  reasons: string[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Rank assets by how far they drift from the rest of the project. Shading legitimately adds
 * off-palette tones, so assets are compared with the project's own median rather than an absolute bar:
 * palette coverage below the median, mean colour distance above it, and a low agent score all add drift.
 * Sorted most-drifted first.
 */
export function rankDrift(items: ConsistencyInput[]): { medianCoverage: number; medianDeltaE: number; items: DriftReport[] } {
  const medianCoverage = median(items.map((i) => i.coverage));
  const medianDeltaE = median(items.map((i) => i.meanDeltaE));
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const out = items.map((i) => {
    const reasons: string[] = [];
    const coverageGap = Math.max(0, medianCoverage - i.coverage);
    const deltaGap = Math.max(0, i.meanDeltaE - medianDeltaE);
    const scoreGap = i.score !== undefined ? Math.max(0, 7 - i.score) : 0;
    if (coverageGap >= 0.1) reasons.push(`色板内像素 ${pct(i.coverage)}，低于项目中位数 ${pct(medianCoverage)}`);
    if (deltaGap >= 5) reasons.push(`平均色差 ΔE ${i.meanDeltaE}，高于项目中位数 ${Math.round(medianDeltaE * 10) / 10}`);
    if (scoreGap > 0) reasons.push(`Agent 一致性评分 ${i.score}/10`);
    const top = i.offPalette[0];
    if (reasons.length && top && top.share >= 0.05) reasons.push(`主要色板外颜色 ${top.hex}（${pct(top.share)}）`);
    const drift = Math.round((coverageGap * 100 + deltaGap + scoreGap * 5) * 10) / 10;
    return { id: i.id, drift, reasons };
  });
  out.sort((a, b) => b.drift - a.drift);
  return { medianCoverage, medianDeltaE, items: out };
}
