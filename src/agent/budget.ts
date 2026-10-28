import type { RunUsage } from "../usage/types.js";
import { msg } from "../i18n.js";

/** Per-run spending limits. null = unlimited. */
export interface Budget {
  maxImages: number | null;
  maxUsd: number | null;
}

/** Past the soft limit Claude is told to stop; past this multiple of maxUsd the loop is cut off. */
export const HARD_STOP_FACTOR = 1.25;

export class BudgetExceededError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BudgetExceededError";
  }
}

const positive = (v: unknown) => {
  const n = Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

/** Image cap when RUN_MAX_IMAGES is not set at all (set it empty for unlimited). */
export const DEFAULT_MAX_IMAGES = 40;

/** Defaults from RUN_MAX_IMAGES / RUN_MAX_USD; a per-run value overrides (0 or empty = unlimited). */
export function resolveBudget(override: { maxImages?: unknown; maxUsd?: unknown } | undefined, env = process.env): Budget {
  const fallback = { maxImages: env.RUN_MAX_IMAGES ?? DEFAULT_MAX_IMAGES, maxUsd: env.RUN_MAX_USD };
  const pick = (key: "maxImages" | "maxUsd") =>
    override && key in override && override[key] !== undefined ? positive(override[key]) : positive(fallback[key]);
  const maxImages = pick("maxImages");
  return { maxImages: maxImages === null ? null : Math.floor(maxImages), maxUsd: pick("maxUsd") };
}

/**
 * Why no more images may be generated in this run, or null if within budget.
 * `inFlight` counts calls already started but not yet recorded, so parallel calls can't overshoot.
 */
export function budgetBlock(budget: Budget, usage: RunUsage, inFlight = 0): string | null {
  if (budget.maxImages !== null && usage.images.calls + inFlight >= budget.maxImages) {
    return msg("run.maxImages", { n: budget.maxImages });
  }
  if (budget.maxUsd !== null && usage.cost.total >= budget.maxUsd) {
    return msg("run.maxUsd", { max: budget.maxUsd, cost: usage.cost.total.toFixed(3) });
  }
  return null;
}

/** True once spending is far enough past maxUsd that the run must end even mid-conversation. */
export const pastHardStop = (budget: Budget, usage: RunUsage) =>
  budget.maxUsd !== null && usage.cost.total >= budget.maxUsd * HARD_STOP_FACTOR;
