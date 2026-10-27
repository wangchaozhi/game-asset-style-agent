import type { AssetStatus, Project } from "../store/types.js";

export interface ProjectStats {
  /** current assets: not superseded by a newer version (trash excluded) */
  current: number;
  byStatus: Record<AssetStatus, number>;
  /** approved / reviewed (approved + rejected); null before anything is reviewed */
  approvalRate: number | null;
  /** mean of the agent's 1-10 consistency scores on current assets; null without scores */
  meanScore: number | null;
  /** per asset type: current and approved counts */
  byType: { type: string; current: number; approved: number }[];
  variants: number;
  /** older versions kept for comparison */
  superseded: number;
  trashed: number;
  /** estimated spend divided by approved assets; null when nothing is approved */
  costPerApproved: number | null;
}

/** Progress at a glance, from the project and its total estimated spend (USD). */
export function projectStats(project: Project, totalCost: number): ProjectStats {
  const superseded = new Set(project.assets.map((a) => a.parentId).filter(Boolean));
  const current = project.assets.filter((a) => !superseded.has(a.id));
  const byStatus: Record<AssetStatus, number> = { approved: 0, pending_review: 0, rejected: 0 };
  for (const a of current) byStatus[a.status]++;
  const reviewed = byStatus.approved + byStatus.rejected;
  const scores = current.filter((a) => a.reviewer === "agent" && typeof a.score === "number").map((a) => a.score!);
  const types = new Map<string, { current: number; approved: number }>();
  for (const a of current) {
    const t = types.get(a.assetType) ?? { current: 0, approved: 0 };
    t.current++;
    if (a.status === "approved") t.approved++;
    types.set(a.assetType, t);
  }
  const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    current: current.length,
    byStatus,
    approvalRate: reviewed ? round(byStatus.approved / reviewed, 3) : null,
    meanScore: scores.length ? round(scores.reduce((s, x) => s + x, 0) / scores.length, 1) : null,
    byType: [...types.entries()].map(([type, c]) => ({ type, ...c })).sort((a, b) => b.current - a.current || a.type.localeCompare(b.type)),
    variants: current.filter((a) => a.variantOf).length,
    superseded: project.assets.length - current.length,
    trashed: project.trash?.length ?? 0,
    costPerApproved: byStatus.approved ? round(totalCost / byStatus.approved, 4) : null,
  };
}
